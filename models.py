# -*- coding: utf-8 -*-
"""資料模型：病人 (Patient) / 化療週期 (ChemoCycle) / 檢驗紀錄 (LabRecord)"""
from datetime import datetime, date
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Patient(db.Model):
    __tablename__ = "patients"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    note = db.Column(db.String(255), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # 可自訂的正常參考值（每位病人一組；預設為台灣報告常見刻度）
    wbc_min = db.Column(db.Float, default=4000)
    wbc_max = db.Column(db.Float, default=10000)
    hb_min = db.Column(db.Float, default=12)
    hb_max = db.Column(db.Float, default=16)
    plt_min = db.Column(db.Float, default=15)
    plt_max = db.Column(db.Float, default=40)
    anc_min = db.Column(db.Float, default=1500)
    anc_danger = db.Column(db.Float, default=500)
    igg_min = db.Column(db.Float, default=700)      # 免疫球蛋白 IgG 下限
    igg_max = db.Column(db.Float, default=1600)     # 免疫球蛋白 IgG 上限

    # 圖表 Y 軸顯示範圍（每項可各自設定；NULL = 自動縮放）
    wbc_axis_min = db.Column(db.Float)
    wbc_axis_max = db.Column(db.Float)
    hb_axis_min = db.Column(db.Float)
    hb_axis_max = db.Column(db.Float)
    plt_axis_min = db.Column(db.Float)
    plt_axis_max = db.Column(db.Float)
    anc_axis_min = db.Column(db.Float)
    anc_axis_max = db.Column(db.Float)
    igg_axis_min = db.Column(db.Float)
    igg_axis_max = db.Column(db.Float)

    # 各項目顯示單位（僅標籤，不換算數值）
    wbc_unit = db.Column(db.String(16), default="/µL")
    hb_unit = db.Column(db.String(16), default="g/dL")
    plt_unit = db.Column(db.String(16), default="萬/µL")
    anc_unit = db.Column(db.String(16), default="/µL")
    igg_unit = db.Column(db.String(16), default="mg/dL")

    # 處置參考線（低於此值常需處置；可調，留空=不顯示）
    wbc_shot_line = db.Column(db.Float)             # 升白針參考線（預設不設）
    hb_tx_line = db.Column(db.Float, default=8)     # 輸血參考線
    plt_tx_line = db.Column(db.Float, default=3.5)  # 輸血小板參考線

    # 各項目圖表顯示開關
    # *_show_points：勾選=畫實心圓點，不勾=只畫直線（預設 True）
    # *_tx_as_text：勾選=處置以文字標籤呈現，不勾=以空心圓圈呈現（預設 False）
    wbc_show_points = db.Column(db.Boolean, default=True)
    hb_show_points = db.Column(db.Boolean, default=True)
    plt_show_points = db.Column(db.Boolean, default=True)
    anc_show_points = db.Column(db.Boolean, default=True)
    igg_show_points = db.Column(db.Boolean, default=True)
    wbc_tx_as_text = db.Column(db.Boolean, default=False)
    hb_tx_as_text = db.Column(db.Boolean, default=False)
    plt_tx_as_text = db.Column(db.Boolean, default=False)
    anc_tx_as_text = db.Column(db.Boolean, default=False)
    igg_tx_as_text = db.Column(db.Boolean, default=False)
    # *_show_band：勾選=顯示正常區間綠帶與下限綠虛線，不勾=不畫（預設 True）
    wbc_show_band = db.Column(db.Boolean, default=True)
    hb_show_band = db.Column(db.Boolean, default=True)
    plt_show_band = db.Column(db.Boolean, default=True)
    anc_show_band = db.Column(db.Boolean, default=True)
    igg_show_band = db.Column(db.Boolean, default=True)

    preparer = db.Column(db.String(50), default="")  # 製表人（匯出檔頭用，記住上次）
    hospital = db.Column(db.String(80), default="")  # 醫院名稱（記住上次，可不同病人不同院）

    cycles = db.relationship(
        "ChemoCycle", backref="patient",
        cascade="all, delete-orphan", lazy=True,
    )

    def ranges(self):
        d = lambda v, dv: v if v is not None else dv
        return {
            "wbc": {"min": d(self.wbc_min, 4000), "max": d(self.wbc_max, 10000), "danger": None},
            "hb":  {"min": d(self.hb_min, 12),   "max": d(self.hb_max, 16),   "danger": None},
            "plt": {"min": d(self.plt_min, 15),  "max": d(self.plt_max, 40),  "danger": None},
            "anc": {"min": d(self.anc_min, 1500), "max": None, "danger": d(self.anc_danger, 500)},
            "igg": {"min": d(self.igg_min, 700), "max": d(self.igg_max, 1600), "danger": None},
        }

    def units(self):
        d = lambda v, dv: v if v else dv
        return {
            "wbc": d(self.wbc_unit, "/µL"),
            "hb":  d(self.hb_unit, "g/dL"),
            "plt": d(self.plt_unit, "萬/µL"),
            "anc": d(self.anc_unit, "/µL"),
            "igg": d(self.igg_unit, "mg/dL"),
        }

    def tx_lines(self):
        return {
            "wbc": self.wbc_shot_line,
            "hb": self.hb_tx_line if self.hb_tx_line is not None else 8,
            "plt": self.plt_tx_line if self.plt_tx_line is not None else 3.5,
        }

    def display_opts(self):
        """每個項目的圖表顯示開關。None（舊資料未設）視為預設值。"""
        sp = lambda v: True if v is None else bool(v)   # show_points 預設 True
        tx = lambda v: False if v is None else bool(v)  # tx_as_text 預設 False
        bd = lambda v: True if v is None else bool(v)   # show_band 預設 True
        return {
            "wbc": {"show_points": sp(self.wbc_show_points), "tx_as_text": tx(self.wbc_tx_as_text), "show_band": bd(self.wbc_show_band)},
            "hb":  {"show_points": sp(self.hb_show_points),  "tx_as_text": tx(self.hb_tx_as_text),  "show_band": bd(self.hb_show_band)},
            "plt": {"show_points": sp(self.plt_show_points), "tx_as_text": tx(self.plt_tx_as_text), "show_band": bd(self.plt_show_band)},
            "anc": {"show_points": sp(self.anc_show_points), "tx_as_text": tx(self.anc_tx_as_text), "show_band": bd(self.anc_show_band)},
            "igg": {"show_points": sp(self.igg_show_points), "tx_as_text": tx(self.igg_tx_as_text), "show_band": bd(self.igg_show_band)},
        }

    def axis_bounds(self):
        """每個項目的圖表 Y 軸顯示範圍（NULL = 自動縮放）。"""
        return {
            "wbc": {"min": self.wbc_axis_min, "max": self.wbc_axis_max},
            "hb":  {"min": self.hb_axis_min,  "max": self.hb_axis_max},
            "plt": {"min": self.plt_axis_min, "max": self.plt_axis_max},
            "anc": {"min": self.anc_axis_min, "max": self.anc_axis_max},
            "igg": {"min": self.igg_axis_min, "max": self.igg_axis_max},
        }

    def to_dict(self):
        return {
            "id": self.id, "name": self.name,
            "note": self.note or "",
            "ranges": self.ranges(), "units": self.units(),
            "txLines": self.tx_lines(),
            "displayOpts": self.display_opts(),
            "axisBounds": self.axis_bounds(),
            "preparer": self.preparer or "",
            "hospital": self.hospital or "",
        }


class ChemoCycle(db.Model):
    """一次化療療程（第 N 次），有一個開始日期。"""
    __tablename__ = "chemo_cycles"
    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(
        db.Integer, db.ForeignKey("patients.id"), nullable=False
    )
    cycle_number = db.Column(db.Integer, nullable=False)  # 第 N 次
    start_date = db.Column(db.Date, nullable=False)       # 該次化療第一天

    records = db.relationship(
        "LabRecord", backref="cycle",
        cascade="all, delete-orphan", lazy=True,
    )

    __table_args__ = (
        db.UniqueConstraint("patient_id", "cycle_number", name="uq_patient_cycle"),
    )


class LabRecord(db.Model):
    """單筆血液檢驗報告。"""
    __tablename__ = "lab_records"
    id = db.Column(db.Integer, primary_key=True)
    cycle_id = db.Column(
        db.Integer, db.ForeignKey("chemo_cycles.id"), nullable=False
    )
    record_date = db.Column(db.Date, nullable=False)  # 抽血日期
    wbc = db.Column(db.Float)   # 白血球
    hb = db.Column(db.Float)    # 血色素
    plt = db.Column(db.Float)   # 血小板
    anc = db.Column(db.Float)   # 中性球
    igg = db.Column(db.Float)   # 免疫球蛋白 IgG（不一定每次都驗，允許 NULL）
    # 當天處置
    wbc_shot = db.Column(db.Boolean, default=False)  # 施打白血球增生劑（升白針）
    rbc_tx = db.Column(db.Boolean, default=False)    # 輸血（紅血球）
    plt_tx = db.Column(db.Boolean, default=False)    # 輸血小板
    ivig_bottles = db.Column(db.Float)               # 免疫球蛋白 IVIg 瓶數（一瓶 5g；NULL=未施打）
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def day_index(self):
        """化療第幾天（Day 1 = 化療第一天）。"""
        return (self.record_date - self.cycle.start_date).days + 1

    def to_dict(self):
        return {
            "id": self.id,
            "cycle_id": self.cycle_id,
            "cycle_number": self.cycle.cycle_number,
            "cycle_start": self.cycle.start_date.isoformat(),
            "record_date": self.record_date.isoformat(),
            "day": self.day_index(),
            "wbc": self.wbc,
            "hb": self.hb,
            "plt": self.plt,
            "anc": self.anc,
            "igg": self.igg,
            "wbc_shot": bool(self.wbc_shot),
            "rbc_tx": bool(self.rbc_tx),
            "plt_tx": bool(self.plt_tx),
            "ivig_bottles": self.ivig_bottles,
        }
