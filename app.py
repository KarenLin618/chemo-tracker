# -*- coding: utf-8 -*-
"""化療血液檢驗追蹤 — Flask 後端
本機開發若無 DATABASE_URL，會自動改用 SQLite，方便測試。
Railway 上會自動帶入 PostgreSQL 的 DATABASE_URL。
"""
import os
from datetime import date

from flask import Flask, jsonify, request, render_template, abort
from models import db, Patient, ChemoCycle, LabRecord


def normalize_db_url(url: str) -> str:
    # Railway/Heroku 舊格式 postgres:// → postgresql://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # 明確指定使用 psycopg v3 驅動（psycopg[binary]，對 Python 3.13 支援完整）。
    # 未帶 driver 的 postgresql:// 預設會找 psycopg2，故在此補上 +psycopg。
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def create_app():
    app = Flask(__name__)

    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url:
        app.config["SQLALCHEMY_DATABASE_URI"] = normalize_db_url(db_url)
    else:
        # 防呆：部署環境（Railway 會注入 PORT）卻沒有 DATABASE_URL 時，
        # 直接拒絕啟動。否則會悄悄退回容器內 SQLite，部署重啟就清空＝掉資料。
        if os.environ.get("PORT"):
            raise RuntimeError(
                "偵測到部署環境（有 PORT）但沒有設定 DATABASE_URL。"
                "請在服務的 Variables 加上 DATABASE_URL=${{Postgres.DATABASE_URL}}"
                "（連到 PostgreSQL），避免資料寫進容器內 SQLite 而於重新部署時遺失。"
            )
        # 純本機開發後備（沒有 PORT 才走這裡）
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///local.db"

    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)

    with app.app_context():
        db.create_all()

    register_routes(app)
    return app


def parse_date(s):
    return date.fromisoformat(s)


def to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def register_routes(app):

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/healthz")
    def healthz():
        return {"status": "ok"}

    # ---------- 病人 ----------
    @app.get("/api/patients")
    def list_patients():
        patients = Patient.query.order_by(Patient.created_at.asc()).all()
        return jsonify([p.to_dict() for p in patients])

    @app.post("/api/patients")
    def create_patient():
        data = request.get_json(force=True)
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "請輸入病人姓名／代號"}), 400
        p = Patient(name=name, note=(data.get("note") or "").strip())
        db.session.add(p)
        db.session.commit()
        return jsonify(p.to_dict()), 201

    @app.delete("/api/patients/<int:pid>")
    def delete_patient(pid):
        p = Patient.query.get_or_404(pid)
        db.session.delete(p)
        db.session.commit()
        return jsonify({"ok": True})

    @app.put("/api/patients/<int:pid>/preparer")
    def update_preparer(pid):
        """記住該病人的製表人與醫院名稱，下次自動帶入。"""
        p = Patient.query.get_or_404(pid)
        data = request.get_json(force=True)
        if "preparer" in data:
            p.preparer = (data.get("preparer") or "").strip()[:50]
        if "hospital" in data:
            p.hospital = (data.get("hospital") or "").strip()[:80]
        db.session.commit()
        return jsonify({"ok": True, "preparer": p.preparer, "hospital": p.hospital})

    @app.put("/api/patients/<int:pid>/settings")
    def update_settings(pid):
        """更新該病人的正常參考值。"""
        p = Patient.query.get_or_404(pid)
        data = request.get_json(force=True)

        def pick(key, cur):
            v = to_float(data.get(key))
            return v if v is not None else cur

        p.wbc_min = pick("wbc_min", p.wbc_min)
        p.wbc_max = pick("wbc_max", p.wbc_max)
        p.hb_min = pick("hb_min", p.hb_min)
        p.hb_max = pick("hb_max", p.hb_max)
        p.plt_min = pick("plt_min", p.plt_min)
        p.plt_max = pick("plt_max", p.plt_max)
        p.anc_min = pick("anc_min", p.anc_min)
        p.anc_danger = pick("anc_danger", p.anc_danger)
        p.igg_min = pick("igg_min", p.igg_min)
        p.igg_max = pick("igg_max", p.igg_max)

        # 單位（字串，僅標籤）
        p.wbc_unit = data.get("wbc_unit") or p.wbc_unit
        p.hb_unit = data.get("hb_unit") or p.hb_unit
        p.plt_unit = data.get("plt_unit") or p.plt_unit
        p.anc_unit = data.get("anc_unit") or p.anc_unit
        p.igg_unit = data.get("igg_unit") or p.igg_unit

        # 處置參考線（允許清空 = null）
        if "wbc_shot_line" in data:
            p.wbc_shot_line = to_float(data.get("wbc_shot_line"))
        if "hb_tx_line" in data:
            p.hb_tx_line = to_float(data.get("hb_tx_line"))
        if "plt_tx_line" in data:
            p.plt_tx_line = to_float(data.get("plt_tx_line"))

        # 各項目圖表顯示開關（布林，逐欄寫入）
        for key in ("wbc", "hb", "plt", "anc", "igg"):
            for opt in ("show_points", "tx_as_text"):
                field = f"{key}_{opt}"
                if field in data:
                    setattr(p, field, bool(data.get(field)))
        db.session.commit()
        return jsonify(p.to_dict())

    # ---------- 整合資料（給圖表用） ----------
    @app.get("/api/patients/<int:pid>/data")
    def patient_data(pid):
        p = Patient.query.get_or_404(pid)
        cycles = (
            ChemoCycle.query.filter_by(patient_id=pid)
            .order_by(ChemoCycle.cycle_number.asc())
            .all()
        )
        result = []
        for c in cycles:
            recs = sorted(c.records, key=lambda r: r.record_date)
            result.append({
                "cycle_id": c.id,
                "cycle_number": c.cycle_number,
                "start_date": c.start_date.isoformat(),
                "records": [r.to_dict() for r in recs],
            })
        return jsonify({"patient": p.to_dict(), "cycles": result})

    # ---------- 新增 / 修改 / 刪除 檢驗紀錄 ----------
    @app.put("/api/cycles/<int:cid>")
    def update_cycle(cid):
        """更改某次化療的開始日期（影響該療程每天的 Day 計算）。"""
        cyc = ChemoCycle.query.get_or_404(cid)
        data = request.get_json(force=True)
        if data.get("start_date"):
            try:
                cyc.start_date = parse_date(data["start_date"])
            except (ValueError, TypeError):
                return jsonify({"error": "開始日期格式不正確"}), 400
        db.session.commit()
        return jsonify({
            "cycle_id": cyc.id,
            "cycle_number": cyc.cycle_number,
            "start_date": cyc.start_date.isoformat(),
        })

    @app.delete("/api/cycles/<int:cid>")
    def delete_cycle(cid):
        """刪除整個化療週期（連同該療程所有檢驗紀錄）。"""
        cyc = ChemoCycle.query.get_or_404(cid)
        db.session.delete(cyc)
        db.session.commit()
        return jsonify({"ok": True})

    @app.post("/api/records")
    def add_record():
        """一次完成：若該次化療週期不存在則建立，再寫入檢驗值。"""
        data = request.get_json(force=True)
        try:
            pid = int(data["patient_id"])
            cycle_number = int(data["cycle_number"])
            cycle_start = parse_date(data["cycle_start_date"])
            record_date = parse_date(data["record_date"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"error": "日期或必填欄位格式不正確"}), 400

        Patient.query.get_or_404(pid)

        cycle = ChemoCycle.query.filter_by(
            patient_id=pid, cycle_number=cycle_number
        ).first()
        if cycle is None:
            cycle = ChemoCycle(
                patient_id=pid, cycle_number=cycle_number, start_date=cycle_start
            )
            db.session.add(cycle)
            db.session.flush()
        else:
            # 若使用者更新了該週期的開始日，採用最新輸入
            cycle.start_date = cycle_start

        rec = LabRecord(
            cycle_id=cycle.id,
            record_date=record_date,
            wbc=to_float(data.get("wbc")),
            hb=to_float(data.get("hb")),
            plt=to_float(data.get("plt")),
            anc=to_float(data.get("anc")),
            igg=to_float(data.get("igg")),
            wbc_shot=bool(data.get("wbc_shot")),
            rbc_tx=bool(data.get("rbc_tx")),
            plt_tx=bool(data.get("plt_tx")),
            ivig_bottles=to_float(data.get("ivig_bottles")),
        )
        db.session.add(rec)
        db.session.commit()
        return jsonify(rec.to_dict()), 201

    @app.put("/api/records/<int:rid>")
    def update_record(rid):
        """編輯既有檢驗紀錄（抽血日期與四項數值）。"""
        rec = LabRecord.query.get_or_404(rid)
        data = request.get_json(force=True)
        if data.get("record_date"):
            try:
                rec.record_date = parse_date(data["record_date"])
            except (ValueError, TypeError):
                return jsonify({"error": "抽血日期格式不正確"}), 400
        rec.wbc = to_float(data.get("wbc"))
        rec.hb = to_float(data.get("hb"))
        rec.plt = to_float(data.get("plt"))
        rec.anc = to_float(data.get("anc"))
        rec.igg = to_float(data.get("igg"))
        rec.wbc_shot = bool(data.get("wbc_shot"))
        rec.rbc_tx = bool(data.get("rbc_tx"))
        rec.plt_tx = bool(data.get("plt_tx"))
        rec.ivig_bottles = to_float(data.get("ivig_bottles"))
        db.session.commit()
        return jsonify(rec.to_dict())

    @app.delete("/api/records/<int:rid>")
    def delete_record(rid):
        rec = LabRecord.query.get_or_404(rid)
        db.session.delete(rec)
        db.session.commit()
        return jsonify({"ok": True})

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
