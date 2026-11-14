CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE tripulantes (
    id     TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    rol    TEXT,
    tipo   TEXT NOT NULL DEFAULT 'tripulante' CHECK (tipo IN ('tripulante', 'ambiente'))
);

INSERT INTO tripulantes (id, nombre, rol, tipo) VALUES
    ('T1', 'Cmdte. Ríos', 'Comandante', 'tripulante'),
    ('T2', 'Dra. Vega', 'Especialista de misión', 'tripulante'),
    ('cabina', 'Cabina', 'Ambiente del módulo', 'ambiente');

CREATE TABLE indicadores (
    id         TEXT PRIMARY KEY,
    nombre     TEXT NOT NULL,
    unidad     TEXT NOT NULL,
    categoria  TEXT NOT NULL CHECK (categoria IN ('vital', 'ambiente', 'diario')),
    normal_min DOUBLE PRECISION,
    normal_max DOUBLE PRECISION,
    alerta_min DOUBLE PRECISION,
    alerta_max DOUBLE PRECISION,
    decimales  INT NOT NULL DEFAULT 0
);

INSERT INTO indicadores VALUES
    ('hr',            'Frecuencia cardiaca',   'lpm',   'vital',    50,   100,  40,   130,  0),
    ('spo2',          'Oxígeno en sangre',     '%',     'vital',    95,   100,  90,   100,  0),
    ('temp_corporal', 'Temperatura corporal',  '°C',    'vital',    36.1, 37.5, 35.5, 38.3, 1),
    ('presion_sis',   'Presión sistólica',     'mmHg',  'vital',    90,   130,  80,   160,  0),
    ('presion_dia',   'Presión diastólica',    'mmHg',  'vital',    60,   85,   50,   100,  0),
    ('glucosa',       'Glucosa',               'mg/dL', 'vital',    70,   140,  55,   200,  0),
    ('co2',           'CO₂ en cabina',         'mmHg',  'ambiente', 0,    3,    0,    4,    2),
    ('temp_cabina',   'Temperatura de cabina', '°C',    'ambiente', 18,   27,   16,   29,   1),
    ('humedad',       'Humedad de cabina',     '%',     'ambiente', 25,   70,   20,   75,   0),
    ('radiacion',     'Radiación',             'µSv/h', 'ambiente', 0,    40,   0,    100,  1),
    ('sueno_horas',   'Horas de sueño',        'h',     'diario',   6,    9,    5,    11,   1),
    ('animo',         'Estado de ánimo',       '1-5',   'diario',   3,    5,    2,    5,    0);

CREATE TABLE lecturas (
    tiempo        TIMESTAMPTZ      NOT NULL,
    tripulante_id TEXT             NOT NULL REFERENCES tripulantes (id),
    indicador     TEXT             NOT NULL REFERENCES indicadores (id),
    valor         DOUBLE PRECISION NOT NULL,
    sensor_id     TEXT,
    simulado      BOOLEAN          NOT NULL DEFAULT TRUE
);

SELECT create_hypertable('lecturas', by_range('tiempo', INTERVAL '1 day'));

CREATE INDEX lecturas_trip_ind_tiempo ON lecturas (tripulante_id, indicador, tiempo DESC);

CREATE TABLE metadata (
    tabla       TEXT PRIMARY KEY,
    version     BIGINT      NOT NULL DEFAULT 0,
    actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO metadata (tabla) VALUES ('lecturas');

CREATE MATERIALIZED VIEW lecturas_1min
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket(INTERVAL '1 minute', tiempo) AS bucket,
    tripulante_id,
    indicador,
    avg(valor) AS promedio,
    min(valor) AS minimo,
    max(valor) AS maximo,
    count(*)   AS n
FROM lecturas
GROUP BY bucket, tripulante_id, indicador
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'lecturas_1min',
    start_offset      => INTERVAL '2 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);
