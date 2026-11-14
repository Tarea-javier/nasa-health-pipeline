CREATE TABLE IF NOT EXISTS comandos_ui (
    id     BIGSERIAL PRIMARY KEY,
    creado TIMESTAMPTZ NOT NULL DEFAULT now(),
    accion TEXT        NOT NULL,
    params JSONB       NOT NULL DEFAULT '{}'
);
