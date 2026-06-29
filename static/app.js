/* 化療血液檢驗追蹤 — 前端邏輯 */

// ====== 指標定義（參考值與單位改由每位病人自訂）======
const METRICS = [
  { key: "wbc", label: "白血球 WBC" },
  { key: "hb",  label: "血色素 Hb" },
  { key: "plt", label: "血小板 PLT" },
  { key: "anc", label: "中性球 ANC", danger: true },
  { key: "igg", label: "免疫球蛋白 IgG", optional: true },
];

// 預設正常參考值（新病人初始值；台灣報告常見刻度，可在「參考值設定」中修改）
const DEFAULT_RANGES = {
  wbc: { min: 4000, max: 10000, danger: null },
  hb:  { min: 12,   max: 16,    danger: null },
  plt: { min: 15,   max: 40,    danger: null },
  anc: { min: 1500, max: null,  danger: 500 },
  igg: { min: 700,  max: 1600,  danger: null },
};

// 單位下拉選項（僅顯示標籤，不換算數值）
const UNIT_OPTIONS = {
  wbc: ["/µL", "10³/µL", "萬/µL", "10⁹/L"],
  hb:  ["g/dL", "g/L"],
  plt: ["萬/µL", "10³/µL", "/µL", "10⁹/L"],
  anc: ["/µL", "10³/µL", "萬/µL", "10⁹/L"],
  igg: ["mg/dL", "g/L", "mg/mL"],
};
const DEFAULT_UNITS = { wbc: "/µL", hb: "g/dL", plt: "萬/µL", anc: "/µL", igg: "mg/dL" };

// 各項目對應的處置（圖上標記）
const TREATMENTS = {
  wbc: { flag: "wbc_shot", icon: "💉", name: "升白針" },
  hb:  { flag: "rbc_tx",   icon: "🩸", name: "輸血" },
  plt: { flag: "plt_tx",   icon: "🟣", name: "輸血小板" },
};
// IVIg 免疫球蛋白注射（非綁定單一血液項；標記畫在 IgG 圖上）
const IVIG = { field: "ivig_bottles", chartKey: "igg", gPerBottle: 5, icon: "🧫", name: "免疫球蛋白" };
// 處置參考線預設（低於此值常需處置；null = 不顯示）
const DEFAULT_TX_LINES = { wbc: null, hb: 8, plt: 3.5 };

// 各項目圖表顯示開關預設（show_points=畫實心圓點；tx_as_text=處置以文字呈現；show_band=顯示正常區間綠帶）
const DEFAULT_DISPLAY_OPTS = {
  wbc: { show_points: true, tx_as_text: false, show_band: true },
  hb:  { show_points: true, tx_as_text: false, show_band: true },
  plt: { show_points: true, tx_as_text: false, show_band: true },
  anc: { show_points: true, tx_as_text: false, show_band: true },
  igg: { show_points: true, tx_as_text: false, show_band: true },
};

// 各項目圖表 Y 軸範圍預設（null = 自動縮放）
const DEFAULT_AXIS_BOUNDS = {
  wbc: { min: null, max: null },
  hb:  { min: null, max: null },
  plt: { min: null, max: null },
  anc: { min: null, max: null },
  igg: { min: null, max: null },
};

// 當地今天日期（YYYY-MM-DD），避免用 UTC 造成跨日誤差
function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// 每個療程一個顏色
const CYCLE_COLORS = [
  "#0d9488", "#6366f1", "#db2777", "#ea580c",
  "#0891b2", "#7c3aed", "#16a34a", "#b45309",
];

// 註冊 annotation 外掛（CDN 載入後通常會自動註冊，這裡防呆）
if (window.Chart && window["chartjs-plugin-annotation"]) {
  Chart.register(window["chartjs-plugin-annotation"]);
}

const { createApp } = Vue;

createApp({
  data() {
    return {
      metrics: METRICS,
      patients: [],
      currentPatientId: null,
      cycles: [],            // [{cycle_number, start_date, records:[...]}]
      ranges: JSON.parse(JSON.stringify(DEFAULT_RANGES)),
      units: Object.assign({}, DEFAULT_UNITS),
      unitOptions: UNIT_OPTIONS,
      txLines: Object.assign({}, DEFAULT_TX_LINES),
      displayOpts: JSON.parse(JSON.stringify(DEFAULT_DISPLAY_OPTS)),
      axisBounds: JSON.parse(JSON.stringify(DEFAULT_AXIS_BOUNDS)),
      treatments: TREATMENTS,
      ivig: IVIG,
      charts: {},            // key -> Chart instance
      showAddPatient: false,
      newPatient: { name: "", note: "" },
      editingId: null,
      editForm: { record_date: "", wbc: "", hb: "", plt: "", anc: "", igg: "", wbc_shot: false, rbc_tx: false, plt_tx: false, ivig_bottles: "" },
      showSettings: false,
      settingsForm: {},
      exporting: false,
      preparer: "",
      hospital: "",
      reportDate: localToday(),
      form: {
        cycleSel: null,        // 選的化療次數（數字）或 'new'
        newCycleNumber: 1,
        cycle_start_date: "",
        record_date: localToday(),
        wbc: "", hb: "", plt: "", anc: "", igg: "",
        wbc_shot: false, rbc_tx: false, plt_tx: false, ivig_bottles: "",
      },
      msg: null,
      cycleMsg: "",
    };
  },

  computed: {
    canSubmit() {
      if (!this.currentPatientId || !this.form.record_date) return false;
      if (this.form.cycleSel === "new")
        return !!this.form.newCycleNumber && !!this.form.cycle_start_date;
      return this.form.cycleSel != null && this.form.cycleSel !== "";
    },
    cycleOptions() {
      return [...this.cycles].sort((a, b) => a.cycle_number - b.cycle_number);
    },
    flatRecords() {
      const out = [];
      this.cycles.forEach((c) => c.records.forEach((r) => out.push(r)));
      out.sort((a, b) =>
        a.cycle_number - b.cycle_number || a.day - b.day
      );
      return out;
    },
    recoveryThresholds() {
      return METRICS.map((m) => `${m.label.split(" ")[0]} ${this.ranges[m.key].min}`).join("、");
    },
    currentPatientName() {
      const p = this.patients.find((x) => x.id === this.currentPatientId);
      return p ? p.name : "";
    },
    today() {
      return new Date().toLocaleDateString("zh-TW");
    },
    cycleTreatmentStats() {
      const arr = [...this.cycles]
        .sort((a, b) => a.cycle_number - b.cycle_number)
        .map((c) => {
          let w = 0, r = 0, p = 0, ivig = 0, ivigG = 0;
          c.records.forEach((rec) => {
            if (rec.wbc_shot) w++;
            if (rec.rbc_tx) r++;
            if (rec.plt_tx) p++;
            if (rec.ivig_bottles) { ivig++; ivigG += rec.ivig_bottles * IVIG.gPerBottle; }
          });
          return { cycle_number: c.cycle_number, wbc_shot: w, rbc_tx: r, plt_tx: p, ivig, ivigG };
        });
      arr.forEach((s, i) => {
        if (i === 0) { s.d = null; return; }
        const prev = arr[i - 1];
        s.d = {
          wbc_shot: s.wbc_shot - prev.wbc_shot,
          rbc_tx: s.rbc_tx - prev.rbc_tx,
          plt_tx: s.plt_tx - prev.plt_tx,
          ivig: s.ivig - prev.ivig,
        };
      });
      return arr;
    },
    hasAnyTreatment() {
      return this.cycleTreatmentStats.some(
        (s) => s.wbc_shot || s.rbc_tx || s.plt_tx || s.ivig
      );
    },
  },

  mounted() {
    this.loadPatients();
  },

  methods: {
    fmt(v) {
      return v === null || v === undefined ? "—" : v;
    },
    txdClass(delta) {
      return delta < 0 ? "good" : delta > 0 ? "bad" : "flat";
    },
    txdText(delta) {
      if (delta < 0) return "▼" + (-delta);
      if (delta > 0) return "▲" + delta;
      return "＝";
    },

    async loadPatients() {
      const res = await fetch("/api/patients");
      this.patients = await res.json();
      if (!this.currentPatientId && this.patients.length) {
        this.currentPatientId = this.patients[0].id;
        this.loadData();
      }
    },

    async addPatient() {
      const name = this.newPatient.name.trim();
      if (!name) return;
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.newPatient),
      });
      if (res.ok) {
        const p = await res.json();
        this.patients.push(p);
        this.currentPatientId = p.id;
        this.newPatient = { name: "", note: "" };
        this.showAddPatient = false;
        this.loadData();
      }
    },

    async loadData() {
      if (!this.currentPatientId) return;
      const res = await fetch(`/api/patients/${this.currentPatientId}/data`);
      const data = await res.json();
      this.cycles = data.cycles;
      if (data.patient && data.patient.ranges) {
        this.ranges = Object.assign(
          JSON.parse(JSON.stringify(DEFAULT_RANGES)), data.patient.ranges
        );
      }
      if (data.patient && data.patient.units) {
        this.units = Object.assign({}, DEFAULT_UNITS, data.patient.units);
      }
      if (data.patient && data.patient.txLines) {
        this.txLines = Object.assign({}, DEFAULT_TX_LINES, data.patient.txLines);
      }
      if (data.patient && data.patient.displayOpts) {
        const merged = JSON.parse(JSON.stringify(DEFAULT_DISPLAY_OPTS));
        Object.keys(data.patient.displayOpts).forEach((k) => {
          merged[k] = Object.assign({}, merged[k], data.patient.displayOpts[k]);
        });
        this.displayOpts = merged;
      }
      if (data.patient && data.patient.axisBounds) {
        const merged = JSON.parse(JSON.stringify(DEFAULT_AXIS_BOUNDS));
        Object.keys(data.patient.axisBounds).forEach((k) => {
          merged[k] = Object.assign({}, merged[k], data.patient.axisBounds[k]);
        });
        this.axisBounds = merged;
      }
      this.preparer = (data.patient && data.patient.preparer) || "";
      this.hospital = (data.patient && data.patient.hospital) || "";
      this.syncCycleDefault();
      this.$nextTick(() => this.renderAll());
    },

    onPatientChange() {
      this.form.cycleSel = null; // 換病人 → 重新挑該病人最新療程
      this.loadData();
    },
    // 依目前 cycleSel 帶出開始日；'new' 則建議下一個次數
    applyCycleSelection() {
      if (this.form.cycleSel === "new") {
        const maxN = this.cycles.reduce((m, c) => Math.max(m, c.cycle_number), 0);
        this.form.newCycleNumber = maxN + 1;
        this.form.cycle_start_date = "";
      } else {
        const cyc = this.cycles.find((c) => c.cycle_number === this.form.cycleSel);
        if (cyc) this.form.cycle_start_date = cyc.start_date;
      }
    },
    // 載入後：保留有效選擇，否則挑最新療程；無療程則進入新增模式
    syncCycleDefault() {
      if (!this.cycles.length) {
        this.form.cycleSel = "new";
        this.form.newCycleNumber = 1;
        this.form.cycle_start_date = "";
        return;
      }
      const valid =
        this.form.cycleSel === "new" ||
        this.cycles.some((c) => c.cycle_number === this.form.cycleSel);
      if (!valid) {
        const latest = [...this.cycles].sort((a, b) => b.cycle_number - a.cycle_number)[0];
        this.form.cycleSel = latest.cycle_number;
      }
      this.applyCycleSelection();
    },

    refText(m) {
      const r = this.ranges[m.key];
      if (m.danger) return `≥${r.min}（<${r.danger} 高風險）`;
      return `${r.min}–${r.max}`;
    },

    async submitRecord() {
      if (!this.canSubmit) return;
      let cycleNumber, cycleStart;
      if (this.form.cycleSel === "new") {
        cycleNumber = this.form.newCycleNumber;
        cycleStart = this.form.cycle_start_date;
      } else {
        cycleNumber = this.form.cycleSel;
        const cyc = this.cycles.find((c) => c.cycle_number === cycleNumber);
        cycleStart = cyc ? cyc.start_date : this.form.cycle_start_date;
      }
      const body = {
        patient_id: this.currentPatientId,
        cycle_number: cycleNumber,
        cycle_start_date: cycleStart,
        record_date: this.form.record_date,
        wbc: this.form.wbc, hb: this.form.hb,
        plt: this.form.plt, anc: this.form.anc, igg: this.form.igg,
        wbc_shot: this.form.wbc_shot, rbc_tx: this.form.rbc_tx, plt_tx: this.form.plt_tx,
        ivig_bottles: this.form.ivig_bottles,
      };
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        this.msg = { type: "ok", text: "已儲存 ✓" };
        // 新療程儲存後，下次自動停在這一次
        if (this.form.cycleSel === "new") this.form.cycleSel = cycleNumber;
        this.form.wbc = this.form.hb = this.form.plt = this.form.anc = this.form.igg = "";
        this.form.wbc_shot = this.form.rbc_tx = this.form.plt_tx = false;
        this.form.ivig_bottles = "";
        await this.loadData();
      } else {
        const e = await res.json();
        this.msg = { type: "err", text: e.error || "儲存失敗" };
      }
      setTimeout(() => (this.msg = null), 2500);
    },

    async deleteRecord(id) {
      if (!confirm("確定刪除這筆紀錄？")) return;
      await fetch(`/api/records/${id}`, { method: "DELETE" });
      this.loadData();
    },

    async saveCycleStart(c) {
      if (!c.start_date) return;
      const res = await fetch(`/api/cycles/${c.cycle_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: c.start_date }),
      });
      if (res.ok) {
        this.cycleMsg = `第${c.cycle_number}次開始日已更新 ✓`;
        await this.loadData();
        setTimeout(() => (this.cycleMsg = ""), 2500);
      } else {
        const e = await res.json();
        alert(e.error || "更新失敗");
      }
    },
    async deleteCycle(c) {
      const n = (c.records && c.records.length) || 0;
      if (!confirm(`確定刪除「第${c.cycle_number}次化療」？\n該療程的 ${n} 筆檢驗紀錄與處置會一併永久刪除，無法復原。`))
        return;
      const res = await fetch(`/api/cycles/${c.cycle_id}`, { method: "DELETE" });
      if (res.ok) {
        this.cycleMsg = `第${c.cycle_number}次化療已刪除`;
        await this.loadData();
        setTimeout(() => (this.cycleMsg = ""), 2500);
      } else {
        alert("刪除失敗");
      }
    },

    startEdit(r) {
      this.editingId = r.id;
      this.editForm = {
        record_date: r.record_date,
        wbc: r.wbc ?? "", hb: r.hb ?? "",
        plt: r.plt ?? "", anc: r.anc ?? "", igg: r.igg ?? "",
        wbc_shot: !!r.wbc_shot, rbc_tx: !!r.rbc_tx, plt_tx: !!r.plt_tx,
        ivig_bottles: r.ivig_bottles ?? "",
      };
    },
    cancelEdit() {
      this.editingId = null;
    },
    async saveEdit() {
      const res = await fetch(`/api/records/${this.editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.editForm),
      });
      if (res.ok) {
        this.editingId = null;
        this.msg = { type: "ok", text: "已更新 ✓" };
        await this.loadData();
        setTimeout(() => (this.msg = null), 2000);
      } else {
        const e = await res.json();
        alert(e.error || "更新失敗");
      }
    },

    async deletePatient() {
      const p = this.patients.find((x) => x.id === this.currentPatientId);
      if (!p) return;
      if (!confirm(`確定刪除病人「${p.name}」？\n該病人所有化療週期與檢驗紀錄將一併永久刪除，無法復原。`))
        return;
      const res = await fetch(`/api/patients/${p.id}`, { method: "DELETE" });
      if (res.ok) {
        this.patients = this.patients.filter((x) => x.id !== p.id);
        this.currentPatientId = this.patients.length ? this.patients[0].id : null;
        this.cycles = [];
        if (this.currentPatientId) this.loadData();
      }
    },

    // ====== 參考值設定 ======
    openSettings() {
      this.settingsForm = {
        wbc_min: this.ranges.wbc.min, wbc_max: this.ranges.wbc.max,
        hb_min: this.ranges.hb.min, hb_max: this.ranges.hb.max,
        plt_min: this.ranges.plt.min, plt_max: this.ranges.plt.max,
        anc_min: this.ranges.anc.min, anc_danger: this.ranges.anc.danger,
        igg_min: this.ranges.igg.min, igg_max: this.ranges.igg.max,
        wbc_unit: this.units.wbc, hb_unit: this.units.hb,
        plt_unit: this.units.plt, anc_unit: this.units.anc, igg_unit: this.units.igg,
        wbc_shot_line: this.txLines.wbc, hb_tx_line: this.txLines.hb, plt_tx_line: this.txLines.plt,
      };
      this.applyDisplayOptsToForm(this.displayOpts);
      this.applyAxisBoundsToForm(this.axisBounds);
      this.showSettings = true;
    },
    // 把每項目顯示開關攤平進 settingsForm（<key>_show_points / _tx_as_text / _show_band）
    applyDisplayOptsToForm(opts) {
      METRICS.forEach((m) => {
        const o = opts[m.key] || DEFAULT_DISPLAY_OPTS[m.key];
        this.settingsForm[m.key + "_show_points"] = o.show_points;
        this.settingsForm[m.key + "_tx_as_text"] = o.tx_as_text;
        this.settingsForm[m.key + "_show_band"] = o.show_band !== false;
      });
    },
    // 把每項目 Y 軸範圍攤平進 settingsForm（<key>_axis_min / _axis_max；null → 空字串）
    applyAxisBoundsToForm(bounds) {
      METRICS.forEach((m) => {
        const b = bounds[m.key] || DEFAULT_AXIS_BOUNDS[m.key];
        this.settingsForm[m.key + "_axis_min"] = b.min == null ? "" : b.min;
        this.settingsForm[m.key + "_axis_max"] = b.max == null ? "" : b.max;
      });
    },
    resetSettings() {
      const d = DEFAULT_RANGES;
      this.settingsForm = {
        wbc_min: d.wbc.min, wbc_max: d.wbc.max,
        hb_min: d.hb.min, hb_max: d.hb.max,
        plt_min: d.plt.min, plt_max: d.plt.max,
        anc_min: d.anc.min, anc_danger: d.anc.danger,
        igg_min: d.igg.min, igg_max: d.igg.max,
        wbc_unit: DEFAULT_UNITS.wbc, hb_unit: DEFAULT_UNITS.hb,
        plt_unit: DEFAULT_UNITS.plt, anc_unit: DEFAULT_UNITS.anc, igg_unit: DEFAULT_UNITS.igg,
        wbc_shot_line: DEFAULT_TX_LINES.wbc, hb_tx_line: DEFAULT_TX_LINES.hb, plt_tx_line: DEFAULT_TX_LINES.plt,
      };
      this.applyDisplayOptsToForm(DEFAULT_DISPLAY_OPTS);
      this.applyAxisBoundsToForm(DEFAULT_AXIS_BOUNDS);
    },
    async saveSettings() {
      const res = await fetch(`/api/patients/${this.currentPatientId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.settingsForm),
      });
      if (res.ok) {
        const p = await res.json();
        const idx = this.patients.findIndex((x) => x.id === p.id);
        if (idx >= 0) this.patients[idx] = p;
        this.showSettings = false;
        await this.loadData(); // 重新套用門檻並重畫
      } else {
        alert("設定儲存失敗");
      }
    },

    async saveHeaderInfo() {
      if (!this.currentPatientId) return;
      await fetch(`/api/patients/${this.currentPatientId}/preparer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preparer: this.preparer, hospital: this.hospital }),
      });
    },

    // ====== 匯出 PNG / PDF ======
    async captureCanvas() {
      const el = this.$refs.capture;
      return await html2canvas(el, {
        scale: 2,
        backgroundColor: "#f5f7f8",
        useCORS: true,
      });
    },
    fileStem() {
      const d = this.reportDate || new Date().toISOString().slice(0, 10);
      return `血液檢驗_${this.currentPatientName || "病人"}_${d}`;
    },
    // canvas → Blob（比 toDataURL 省記憶體，手機較不易失敗）
    canvasToBlob(canvas, mime) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas 轉檔失敗"))),
          mime
        );
      });
    },
    // 是否為行動裝置（手機/平板）。桌機即使支援 Web Share 仍走直接下載。
    isMobileDevice() {
      const ua = navigator.userAgent || "";
      return (
        /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) // iPadOS 偽裝成 Mac
      );
    },
    // 交付檔案：手機叫系統「分享」、桌機直接下載、手機不支援分享就開新分頁長按存檔
    async deliverBlob(blob, filename, mime) {
      const mobile = this.isMobileDevice();
      // 1) 行動裝置且支援檔案分享：Web Share（可存圖片/存檔/傳 LINE/AirDrop/列印）
      if (mobile && navigator.canShare) {
        const file = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return; // 分享完成或使用者取消都算結束
          } catch (e) {
            if (e && e.name === "AbortError") return; // 使用者取消，不視為錯誤
            // 其他錯誤 → 往下退回
          }
        }
      }
      const url = URL.createObjectURL(blob);
      if (!mobile) {
        // 2) 桌機：直接下載（維持原行為）
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        // 3) 行動裝置但無法分享：開新分頁，使用者可長按圖片儲存
        window.open(url, "_blank");
        alert("已在新分頁開啟，請長按圖片或用瀏覽器選單儲存。");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async exportImage() {
      this.exporting = true;
      try {
        const canvas = await this.captureCanvas();
        const blob = await this.canvasToBlob(canvas, "image/png");
        await this.deliverBlob(blob, this.fileStem() + ".png", "image/png");
      } catch (e) {
        alert("匯出圖片失敗：" + e.message);
      } finally {
        this.exporting = false;
      }
    },
    async footerImage(text) {
      // 用 html2canvas 產生中文頁尾圖（jsPDF 內建字型不支援中文）
      const div = document.createElement("div");
      div.style.cssText =
        'position:fixed;left:-9999px;top:0;font-family:"Noto Sans TC",sans-serif;' +
        "font-size:22px;color:#888;white-space:nowrap;padding:2px 6px;";
      div.textContent = text;
      document.body.appendChild(div);
      const c = await html2canvas(div, { backgroundColor: null, scale: 2 });
      document.body.removeChild(div);
      return c;
    },
    async exportPDF() {
      this.exporting = true;
      try {
        const canvas = await this.captureCanvas();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF("p", "mm", "a4");
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const footerBand = 12;                 // 底部保留給頁碼
        const imgWmm = pw - margin * 2;
        const pxPerMm = canvas.width / imgWmm;  // 影像縮放比
        const pageContentHmm = ph - margin - footerBand;
        const sliceHpx = Math.floor(pageContentHmm * pxPerMm);
        const totalPages = Math.max(1, Math.ceil(canvas.height / sliceHpx));

        for (let p = 0; p < totalPages; p++) {
          if (p > 0) pdf.addPage();
          const sy = p * sliceHpx;
          const sh = Math.min(sliceHpx, canvas.height - sy);
          // 切出該頁區塊
          const sc = document.createElement("canvas");
          sc.width = canvas.width;
          sc.height = sh;
          const sctx = sc.getContext("2d");
          // JPEG 不支援透明，先鋪白底再貼圖（避免透明處變黑）
          sctx.fillStyle = "#f5f7f8";
          sctx.fillRect(0, 0, sc.width, sh);
          sctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
          const sliceHmm = sh / pxPerMm;
          // 用 JPEG（品質 0.85）大幅縮小檔案：PNG 約 45MB → JPEG 約 2–3MB，
          // 手機分享/開啟才不會因檔案過大而失敗（Chrome 空白頁）
          pdf.addImage(sc.toDataURL("image/jpeg", 0.85), "JPEG", margin, margin, imgWmm, sliceHmm);
          // 中文頁碼頁尾
          const footer = await this.footerImage(`第 ${p + 1} 頁，共 ${totalPages} 頁`);
          const fw = 46;
          const fh = (footer.height * fw) / footer.width;
          pdf.addImage(footer.toDataURL("image/png"), "PNG", (pw - fw) / 2, ph - fh - 4, fw, fh);
        }
        const blob = pdf.output("blob");
        await this.deliverBlob(blob, this.fileStem() + ".pdf", "application/pdf");
      } catch (e) {
        alert("匯出 PDF 失敗：" + e.message);
      } finally {
        this.exporting = false;
      }
    },

    // ====== 進步比對：用最低點 (nadir) 對照 ======
    nadir(cycle, key) {
      const vals = cycle.records
        .map((r) => r[key])
        .filter((v) => v !== null && v !== undefined);
      return vals.length ? Math.min(...vals) : null;
    },
    latestTwo() {
      const sorted = [...this.cycles].sort(
        (a, b) => a.cycle_number - b.cycle_number
      );
      return { prev: sorted[sorted.length - 2], curr: sorted[sorted.length - 1] };
    },
    trendInfo(key) {
      const { prev, curr } = this.latestTwo();
      if (!curr) return { state: "none" };
      const cur = this.nadir(curr, key);
      if (cur === null) return { state: "none" };
      if (!prev) return { state: "single", curr: cur };
      const pre = this.nadir(prev, key);
      if (pre === null) return { state: "single", curr: cur };
      const diff = cur - pre;
      return { state: diff > 0 ? "up" : diff < 0 ? "down" : "flat", diff, pre, cur };
    },
    trendArrow(key) {
      const s = this.trendInfo(key).state;
      return { up: "▲", down: "▼", flat: "＝", single: "•", none: "–" }[s];
    },
    trendClass(key) {
      const s = this.trendInfo(key).state;
      return { up: "good", down: "bad", flat: "flat", single: "flat", none: "flat" }[s];
    },
    trendText(key) {
      const info = this.trendInfo(key);
      const unit = this.units[key];
      if (info.state === "none") return "尚無資料";
      if (info.state === "single") return `${info.curr}（需兩個療程才能比較）`;
      const word = info.state === "up" ? "進步" : info.state === "down" ? "下降" : "持平";
      const sign = info.diff > 0 ? "+" : "";
      return `${info.pre} → ${info.cur}（${word} ${sign}${info.diff.toFixed(1)} ${unit}）`;
    },

    // ====== 恢復天數比對：從最低點回到參考值下限要幾天 ======
    recovery(cycle, key) {
      const thr = this.ranges[key].min;
      const recs = cycle.records
        .filter((r) => r[key] !== null && r[key] !== undefined)
        .sort((a, b) => a.day - b.day);
      if (!recs.length) return { status: "nodata" };
      let ni = 0;
      recs.forEach((r, i) => { if (r[key] < recs[ni][key]) ni = i; });
      const nadir = recs[ni];
      if (nadir[key] >= thr)
        return { status: "nodrop", nadir: nadir[key] };
      for (let i = ni + 1; i < recs.length; i++) {
        if (recs[i][key] >= thr)
          return {
            status: "recovered",
            days: recs[i].day - nadir.day,
            nadirDay: nadir.day, recoverDay: recs[i].day,
          };
      }
      return { status: "pending", nadirDay: nadir.day };
    },
    recoveryLabel(rc, key) {
      if (!rc || rc.status === "nodata") return "無資料";
      if (rc.status === "nodrop") return "未低於參考值";
      if (rc.status === "pending") return `尚未回到 ${this.ranges[key].min}`;
      return `${rc.days} 天`;
    },
    recoveryTrend(key) {
      const sorted = [...this.cycles].sort((a, b) => a.cycle_number - b.cycle_number);
      const curr = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      if (!curr) return { state: "none" };
      const rc = this.recovery(curr, key);
      if (!prev) return { state: "single", rc, currN: curr.cycle_number };
      const rp = this.recovery(prev, key);
      return {
        state: "pair", rp, rc,
        prevN: prev.cycle_number, currN: curr.cycle_number,
      };
    },
    recoveryText(key) {
      const t = this.recoveryTrend(key);
      if (t.state === "none") return "尚無資料";
      if (t.state === "single")
        return `第${t.currN}次 ${this.recoveryLabel(t.rc, key)}（需兩個療程才能比較）`;
      const a = this.recoveryLabel(t.rp, key);
      const b = this.recoveryLabel(t.rc, key);
      const base = `第${t.prevN}次 ${a} → 第${t.currN}次 ${b}`;
      if (t.rp.status === "recovered" && t.rc.status === "recovered") {
        const diff = t.rc.days - t.rp.days;
        const word = diff < 0 ? `恢復快了 ${-diff} 天`
          : diff > 0 ? `恢復慢了 ${diff} 天` : "恢復天數相同";
        return `${base}（${word}）`;
      }
      return base;
    },
    recoveryClass(key) {
      const t = this.recoveryTrend(key);
      if (t.state === "single" && t.rc.status === "nodrop") return "good";
      if (t.state !== "pair") return "flat";
      if (t.rc.status === "nodrop") return "good";
      if (t.rp.status === "recovered" && t.rc.status === "recovered") {
        const diff = t.rc.days - t.rp.days;
        return diff < 0 ? "good" : diff > 0 ? "bad" : "flat";
      }
      return "flat";
    },

    // ====== 繪圖 ======
    renderAll() {
      METRICS.forEach((m) => this.renderChart(m));
    },
    renderChart(m) {
      const el = document.getElementById("chart-" + m.key);
      if (!el) return;
      if (this.charts[m.key]) this.charts[m.key].destroy();
      const rng = this.ranges[m.key];
      const tx = TREATMENTS[m.key]; // 該圖對應的處置（anc/igg 無綁定）
      const opt = this.displayOpts[m.key] || DEFAULT_DISPLAY_OPTS[m.key];
      const ab = this.axisBounds[m.key] || DEFAULT_AXIS_BOUNDS[m.key]; // Y 軸範圍（留空=自動）
      const showPoints = opt.show_points !== false; // 預設 true
      const txAsText = opt.tx_as_text === true;      // 預設 false（空心圓）
      // 這張圖要顯示哪些處置：綁定的 tx，加上畫在此圖的 IVIg
      const ivigHere = IVIG.chartKey === m.key ? IVIG : null;
      const annotations = {};

      const datasets = this.cycles.map((c, i) => {
        const color = CYCLE_COLORS[i % CYCLE_COLORS.length];
        const pts = c.records
          .filter((r) => r[m.key] !== null && r[m.key] !== undefined)
          .sort((a, b) => a.day - b.day)
          .map((r) => ({ x: r.day, y: r[m.key] }));
        const ys = pts.map((p) => p.y);

        // 最低點 index（需至少 2 個點才有「最低點」意義；單一點視為一般資料點）
        let nadirIdx = ys.length >= 2 ? ys.indexOf(Math.min(...ys)) : -1;
        // 恢復點 index：最低點之後第一個回到參考下限的點（且確實曾低於下限）
        let recIdx = -1;
        if (rng.min !== null && nadirIdx >= 0 && ys[nadirIdx] < rng.min) {
          for (let k = nadirIdx + 1; k < ys.length; k++) {
            if (ys[k] >= rng.min) { recIdx = k; break; }
          }
        }
        const roles = pts.map((_, k) =>
          k === nadirIdx ? "最低點" : k === recIdx ? "恢復點" : null
        );

        // 處置標記（當天有施打／輸血／IVIg）
        // txAsText=true → 文字標籤；false（預設）→ 在資料點畫空心圓圈
        const addTxMarker = (id, day, yVal, label) => {
          if (yVal === null || yVal === undefined) return;
          if (txAsText) {
            annotations[id] = {
              type: "label",
              xValue: day, yValue: yVal,
              content: [label],
              font: { size: 11, weight: "bold" },
              color: color,
              backgroundColor: "rgba(255,255,255,0.92)",
              borderColor: color, borderWidth: 1, borderRadius: 6,
              padding: 4, yAdjust: -32,
              callout: { display: true, borderColor: color, borderWidth: 1, margin: 4 },
            };
          } else {
            // 處置標記用「虛線空心圈」，與實線的「最低點空心圈」區隔，避免混淆
            annotations[id] = {
              type: "point",
              xValue: day, yValue: yVal,
              radius: 9,
              backgroundColor: "transparent",
              borderColor: color, borderWidth: 2.5, borderDash: [3, 3],
            };
          }
        };
        if (tx) {
          c.records.forEach((r) => {
            if (r[tx.flag])
              addTxMarker("tx_" + i + "_" + r.day, r.day, r[m.key], tx.icon + " " + tx.name);
          });
        }
        if (ivigHere) {
          // IVIg 那天不一定有驗 IgG；沒驗就把標記放在參考下限附近，仍能看見當天有施打
          const fallbackY = rng.min !== null ? rng.min : (ys.length ? Math.min(...ys) : 0);
          c.records.forEach((r) => {
            if (r[IVIG.field]) {
              const g = r[IVIG.field] * IVIG.gPerBottle;
              const yVal = r[m.key] !== null && r[m.key] !== undefined ? r[m.key] : fallbackY;
              addTxMarker("ivig_" + i + "_" + r.day, r.day, yVal,
                IVIG.icon + " " + IVIG.name + " " + g + "g");
            }
          });
        }

        return {
          label: "第" + c.cycle_number + "次",
          data: pts,
          roles,
          borderColor: color,
          backgroundColor: color,
          tension: 0.3,
          borderWidth: 2,
          spanGaps: true,
          pointHoverRadius: showPoints ? 7 : 0,
          // show_points=false → 純直線，所有圓點半徑 0
          pointRadius: pts.map((_, k) =>
            !showPoints ? 0 : k === nadirIdx || k === recIdx ? 7 : 4
          ),
          pointStyle: pts.map((_, k) => (k === recIdx ? "triangle" : "circle")),
          // 檢驗值一律「實心圓」（與處置的空心圈清楚區隔）；最低點以較大實心點＋白邊強調
          pointBackgroundColor: color,
          pointBorderColor: pts.map((_, k) =>
            k === nadirIdx ? "#ffffff" : color
          ),
          pointBorderWidth: pts.map((_, k) =>
            k === nadirIdx ? 3 : k === recIdx ? 2.5 : 1
          ),
        };
      });

      // 正常區間綠帶（可由「顯示綠帶」開關關閉）
      if (rng.min !== null && opt.show_band !== false) {
        annotations.normalBand = {
          type: "box",
          yMin: rng.min,
          yMax: rng.max !== null ? rng.max : undefined,
          backgroundColor: "rgba(16,185,129,0.08)",
          borderWidth: 0,
        };
        annotations.lowLine = {
          type: "line",
          yMin: rng.min, yMax: rng.min,
          borderColor: "rgba(16,185,129,0.5)",
          borderWidth: 1, borderDash: [4, 4],
        };
      }
      // 危險線（ANC）
      if (rng.danger !== null && rng.danger !== undefined) {
        annotations.dangerLine = {
          type: "line",
          yMin: rng.danger, yMax: rng.danger,
          borderColor: "rgba(220,38,38,0.7)",
          borderWidth: 1.5,
          label: {
            display: true, content: "高風險 " + rng.danger,
            position: "start", color: "#dc2626",
            backgroundColor: "rgba(255,255,255,0.85)", font: { size: 10 },
          },
        };
      }
      // 處置參考線（低於此值常需處置）
      if (tx && this.txLines[m.key] !== null && this.txLines[m.key] !== undefined && this.txLines[m.key] !== "") {
        const v = this.txLines[m.key];
        annotations.txLine = {
          type: "line",
          yMin: v, yMax: v,
          borderColor: "rgba(217,119,6,0.8)",
          borderWidth: 1.5, borderDash: [6, 3],
          label: {
            display: true, content: tx.name + "參考 " + v,
            position: "end", color: "#b45309",
            backgroundColor: "rgba(255,255,255,0.85)", font: { size: 10 },
          },
        };
      }

      this.charts[m.key] = new Chart(el, {
        type: "line",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 26 } },
          interaction: { mode: "nearest", intersect: false },
          scales: {
            x: {
              type: "linear",
              min: 1,
              title: { display: true, text: "化療第 N 天（Day）" },
              ticks: { stepSize: 1, callback: (v) => "D" + v },
            },
            y: {
              beginAtZero: false,
              min: ab.min != null && ab.min !== "" ? Number(ab.min) : undefined,
              max: ab.max != null && ab.max !== "" ? Number(ab.max) : undefined,
              title: { display: true, text: this.units[m.key] },
            },
          },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 14, font: { size: 11 } } },
            annotation: { annotations },
            tooltip: {
              callbacks: {
                title: (items) => "化療第 " + items[0].parsed.x + " 天",
                label: (it) => it.dataset.label + "： " + it.parsed.y + " " + this.units[m.key],
                afterLabel: (it) => {
                  const role = it.dataset.roles && it.dataset.roles[it.dataIndex];
                  return role ? "◆ " + role : "";
                },
              },
            },
          },
        },
      });
    },
  },
}).mount("#app");
