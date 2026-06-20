-- ============================================================
-- 化療血液檢驗追蹤 — PostgreSQL Schema
-- ============================================================
-- 注意：全新部署「不需要」手動執行這個檔案。
-- 程式啟動時 db.create_all() 會自動依 models.py 建立所有資料表。
--
-- 這份檔案的用途：
--   1. 留存參考，清楚看到完整資料結構。
--   2. 若你想自己先在 Railway 的 PostgreSQL 手動建好 schema，可直接執行。
--
-- 執行方式（Railway → PostgreSQL → Data/Query 或用 psql）：
--   psql "$DATABASE_URL" -f schema.sql
-- ============================================================

-- 若要整個重建，可先解除下面三行的註解（會刪光現有資料！）
-- DROP TABLE IF EXISTS lab_records CASCADE;
-- DROP TABLE IF EXISTS chemo_cycles CASCADE;
-- DROP TABLE IF EXISTS patients CASCADE;

-- ---------- 病人 ----------
CREATE TABLE IF NOT EXISTS patients (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    note        VARCHAR(255),
    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    -- 可自訂的正常參考值（每位病人一組；預設為台灣報告常見刻度）
    wbc_min     DOUBLE PRECISION DEFAULT 4000,
    wbc_max     DOUBLE PRECISION DEFAULT 10000,
    hb_min      DOUBLE PRECISION DEFAULT 12,
    hb_max      DOUBLE PRECISION DEFAULT 16,
    plt_min     DOUBLE PRECISION DEFAULT 15,
    plt_max     DOUBLE PRECISION DEFAULT 40,
    anc_min     DOUBLE PRECISION DEFAULT 1500,
    anc_danger  DOUBLE PRECISION DEFAULT 500,
    -- 各項目顯示單位（僅標籤，不換算數值）
    wbc_unit    VARCHAR(16) DEFAULT '/µL',
    hb_unit     VARCHAR(16) DEFAULT 'g/dL',
    plt_unit    VARCHAR(16) DEFAULT '萬/µL',
    anc_unit    VARCHAR(16) DEFAULT '/µL',
    -- 處置參考線（低於此值常需處置；NULL = 不顯示）
    wbc_shot_line DOUBLE PRECISION,
    hb_tx_line    DOUBLE PRECISION DEFAULT 8,
    plt_tx_line   DOUBLE PRECISION DEFAULT 3.5,
    preparer      VARCHAR(50) DEFAULT '',
    hospital      VARCHAR(80) DEFAULT ''
);

-- ---------- 化療週期（第 N 次） ----------
CREATE TABLE IF NOT EXISTS chemo_cycles (
    id            SERIAL PRIMARY KEY,
    patient_id    INTEGER NOT NULL,
    cycle_number  INTEGER NOT NULL,           -- 第 N 次
    start_date    DATE NOT NULL,              -- 該次化療第一天
    CONSTRAINT uq_patient_cycle UNIQUE (patient_id, cycle_number),
    CONSTRAINT fk_cycle_patient
        FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
);

-- ---------- 檢驗紀錄 ----------
CREATE TABLE IF NOT EXISTS lab_records (
    id           SERIAL PRIMARY KEY,
    cycle_id     INTEGER NOT NULL,
    record_date  DATE NOT NULL,              -- 抽血日期
    wbc          DOUBLE PRECISION,           -- 白血球
    hb           DOUBLE PRECISION,           -- 血色素
    plt          DOUBLE PRECISION,           -- 血小板
    anc          DOUBLE PRECISION,           -- 中性球
    wbc_shot     BOOLEAN DEFAULT false,      -- 當天施打升白針
    rbc_tx       BOOLEAN DEFAULT false,      -- 當天輸血
    plt_tx       BOOLEAN DEFAULT false,      -- 當天輸血小板
    created_at   TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    CONSTRAINT fk_record_cycle
        FOREIGN KEY (cycle_id) REFERENCES chemo_cycles (id) ON DELETE CASCADE
);

-- ---------- 索引（加速查詢） ----------
CREATE INDEX IF NOT EXISTS idx_cycles_patient ON chemo_cycles (patient_id);
CREATE INDEX IF NOT EXISTS idx_records_cycle  ON lab_records (cycle_id);


-- ============================================================
-- （備用）從「沒有參考值欄位的舊版」升級時才需要：
-- 你目前還沒部署，全新建表用不到這段。日後若有舊資料庫缺欄位，
-- 解除註解執行即可，欄位已存在會被 IF NOT EXISTS 略過。
-- ============================================================
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS wbc_min    DOUBLE PRECISION DEFAULT 4000;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS wbc_max    DOUBLE PRECISION DEFAULT 10000;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS hb_min     DOUBLE PRECISION DEFAULT 12;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS hb_max     DOUBLE PRECISION DEFAULT 16;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS plt_min    DOUBLE PRECISION DEFAULT 15;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS plt_max    DOUBLE PRECISION DEFAULT 40;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS anc_min    DOUBLE PRECISION DEFAULT 1500;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS anc_danger DOUBLE PRECISION DEFAULT 500;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS wbc_unit   VARCHAR(16) DEFAULT '/µL';
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS hb_unit    VARCHAR(16) DEFAULT 'g/dL';
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS plt_unit   VARCHAR(16) DEFAULT '萬/µL';
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS anc_unit   VARCHAR(16) DEFAULT '/µL';
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS wbc_shot_line DOUBLE PRECISION;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS hb_tx_line    DOUBLE PRECISION DEFAULT 8;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS plt_tx_line   DOUBLE PRECISION DEFAULT 3.5;
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS preparer      VARCHAR(50) DEFAULT '';
-- ALTER TABLE patients ADD COLUMN IF NOT EXISTS hospital      VARCHAR(80) DEFAULT '';
-- ALTER TABLE lab_records ADD COLUMN IF NOT EXISTS wbc_shot BOOLEAN DEFAULT false;
-- ALTER TABLE lab_records ADD COLUMN IF NOT EXISTS rbc_tx   BOOLEAN DEFAULT false;
-- ALTER TABLE lab_records ADD COLUMN IF NOT EXISTS plt_tx   BOOLEAN DEFAULT false;
