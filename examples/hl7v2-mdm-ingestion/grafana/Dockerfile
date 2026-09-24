ARG GRAFANA_IMAGE=grafana/grafana:12.4.1
FROM ${GRAFANA_IMAGE}

RUN grafana cli plugins install grafana-clickhouse-datasource

COPY provisioning /etc/grafana/provisioning
COPY dashboards /etc/grafana/dashboards
