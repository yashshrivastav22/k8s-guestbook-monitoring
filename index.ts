import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const config = new pulumi.Config();
const grafanaAdminPassword = config.getSecret("grafanaAdminPassword") ?? pulumi.output("Admin@Grafana123!");

// ─────────────────────────────────────────────────────────────────────────────
// Namespaces
// ─────────────────────────────────────────────────────────────────────────────
const appNs = new k8s.core.v1.Namespace("guestbook-ns", {
    metadata: { name: "guestbook" },
});

const monitoringNs = new k8s.core.v1.Namespace("monitoring-ns", {
    metadata: { name: "monitoring" },
});

const metallbNs = new k8s.core.v1.Namespace("metallb-ns", {
    metadata: { name: "metallb-system" },
});

// ─────────────────────────────────────────────────────────────────────────────
// MetalLB — provides real LoadBalancer IPs for kind clusters
// ─────────────────────────────────────────────────────────────────────────────
const metallb = new k8s.helm.v3.Release("metallb", {
    name: "metallb",
    chart: "metallb",
    version: "0.14.5",
    repositoryOpts: { repo: "https://metallb.github.io/metallb" },
    namespace: metallbNs.metadata.name,
    cleanupOnFail: true,
    timeout: 300,
}, { dependsOn: [metallbNs] });

const metallbIPPool = new k8s.apiextensions.CustomResource("metallb-ip-pool", {
    apiVersion: "metallb.io/v1beta1",
    kind: "IPAddressPool",
    metadata: {
        name: "kind-pool",
        namespace: metallbNs.metadata.name,
    },
    spec: {
        addresses: ["172.18.255.200-172.18.255.250"],
    },
}, { dependsOn: [metallb] });

const metallbL2 = new k8s.apiextensions.CustomResource("metallb-l2", {
    apiVersion: "metallb.io/v1beta1",
    kind: "L2Advertisement",
    metadata: {
        name: "kind-l2",
        namespace: metallbNs.metadata.name,
    },
    spec: {
        ipAddressPools: ["kind-pool"],
    },
}, { dependsOn: [metallbIPPool] });

// ─────────────────────────────────────────────────────────────────────────────
// GUESTBOOK — Redis Leader
// redis_exporter sidecar exposes metrics on :9121
// ─────────────────────────────────────────────────────────────────────────────
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    metadata: { name: "redis-leader", namespace: appNs.metadata.name },
    spec: {
        selector: { matchLabels: { app: "redis", role: "leader", tier: "backend" } },
        replicas: 1,
        template: {
            metadata: {
                labels: { app: "redis", role: "leader", tier: "backend" },
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "9121",
                },
            },
            spec: {
                containers: [
                    {
                        name: "leader",
                        image: "redis:7.2-alpine",
                        ports: [{ containerPort: 6379 }],
                        resources: {
                            requests: { cpu: "100m", memory: "100Mi" },
                            limits: { cpu: "500m", memory: "256Mi" },
                        },
                    },
                    // Sidecar: exposes Redis metrics at :9121/metrics
                    {
                        name: "redis-exporter",
                        image: "oliver006/redis_exporter:v1.58.0-alpine",
                        ports: [{ containerPort: 9121, name: "metrics" }],
                        env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
                        resources: {
                            requests: { cpu: "50m", memory: "32Mi" },
                            limits: { cpu: "100m", memory: "64Mi" },
                        },
                    },
                ],
            },
        },
    },
}, { dependsOn: appNs });

const redisLeaderService = new k8s.core.v1.Service("redis-leader-svc", {
    metadata: { name: "redis-leader", namespace: appNs.metadata.name },
    spec: {
        selector: { app: "redis", role: "leader", tier: "backend" },
        ports: [
            { port: 6379, targetPort: 6379, name: "redis" },
            { port: 9121, targetPort: 9121, name: "metrics" },
        ],
    },
}, { dependsOn: redisLeaderDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// GUESTBOOK — Redis Follower (2 replicas)
// redis_exporter sidecar exposes metrics on :9121
// ─────────────────────────────────────────────────────────────────────────────
const redisFollowerDeployment = new k8s.apps.v1.Deployment("redis-follower", {
    metadata: { name: "redis-follower", namespace: appNs.metadata.name },
    spec: {
        selector: { matchLabels: { app: "redis", role: "follower", tier: "backend" } },
        replicas: 2,
        template: {
            metadata: {
                labels: { app: "redis", role: "follower", tier: "backend" },
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "9121",
                },
            },
            spec: {
                containers: [
                    {
                        name: "follower",
                        image: "redis:7.2-alpine",
                        command: ["redis-server", "--replicaof", "redis-leader", "6379"],
                        ports: [{ containerPort: 6379 }],
                        resources: {
                            requests: { cpu: "100m", memory: "100Mi" },
                            limits: { cpu: "500m", memory: "256Mi" },
                        },
                    },
                    // Sidecar: exposes Redis metrics at :9121/metrics
                    {
                        name: "redis-exporter",
                        image: "oliver006/redis_exporter:v1.58.0-alpine",
                        ports: [{ containerPort: 9121, name: "metrics" }],
                        env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
                        resources: {
                            requests: { cpu: "50m", memory: "32Mi" },
                            limits: { cpu: "100m", memory: "64Mi" },
                        },
                    },
                ],
            },
        },
    },
}, { dependsOn: [appNs, redisLeaderService] });

const redisFollowerService = new k8s.core.v1.Service("redis-follower-svc", {
    metadata: { name: "redis-follower", namespace: appNs.metadata.name },
    spec: {
        selector: { app: "redis", role: "follower", tier: "backend" },
        ports: [
            { port: 6379, targetPort: 6379, name: "redis" },
            { port: 9121, targetPort: 9121, name: "metrics" },
        ],
    },
}, { dependsOn: redisFollowerDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// GUESTBOOK — Frontend (3 replicas)
// Uses GET_HOSTS_FROM=dns to find redis-leader and redis-follower by name
// ─────────────────────────────────────────────────────────────────────────────
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    metadata: { name: "frontend", namespace: appNs.metadata.name },
    spec: {
        selector: { matchLabels: { app: "guestbook", tier: "frontend" } },
        replicas: 3,
        template: {
            metadata: {
                labels: { app: "guestbook", tier: "frontend" },
                // No prometheus scrape annotations — frontend has no metrics endpoint
            },
            spec: {
                containers: [
                    {
                        name: "php-redis",
                        image: "us-docker.pkg.dev/google-samples/containers/gke/gb-frontend:v5",
                        ports: [{ containerPort: 80 }],
                        env: [
                            // dns mode: app looks up redis-leader and redis-follower by DNS
                            { name: "GET_HOSTS_FROM", value: "dns" },
                        ],
                        resources: {
                            requests: { cpu: "100m", memory: "100Mi" },
                            limits: { cpu: "500m", memory: "256Mi" },
                        },
                        livenessProbe: {
                            httpGet: { path: "/", port: 80 },
                            initialDelaySeconds: 10,
                            periodSeconds: 10,
                        },
                        readinessProbe: {
                            httpGet: { path: "/", port: 80 },
                            initialDelaySeconds: 5,
                            periodSeconds: 5,
                        },
                    },
                ],
            },
        },
    },
}, { dependsOn: [appNs, redisLeaderService, redisFollowerService] });

// Frontend Service — LoadBalancer (MetalLB assigns real IP)
const frontendService = new k8s.core.v1.Service("frontend-svc", {
    metadata: { name: "frontend", namespace: appNs.metadata.name },
    spec: {
        type: "LoadBalancer",
        selector: { app: "guestbook", tier: "frontend" },
        ports: [
            { port: 80, targetPort: 80, name: "http" },
        ],
    },
}, { dependsOn: [frontendDeployment, metallbL2] });

// ─────────────────────────────────────────────────────────────────────────────
// PROMETHEUS — kube-prometheus-stack Helm chart
// ─────────────────────────────────────────────────────────────────────────────
const prometheusRelease = new k8s.helm.v3.Release("prometheus", {
    name: "prometheus",
    chart: "kube-prometheus-stack",
    version: "58.4.0",
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    namespace: monitoringNs.metadata.name,
    cleanupOnFail: true,
    timeout: 600,
    values: {
        alertmanager: { enabled: false },
        prometheusOperator: { enabled: true },
        grafana: { enabled: false },
        defaultRules: { create: true },
        kubeStateMetrics: { enabled: true },
        nodeExporter: { enabled: true },
        prometheus: {
            prometheusSpec: {
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
                ruleSelectorNilUsesHelmValues: false,
                // Annotation-based scraping — scrapes pods with prometheus.io/scrape=true
                additionalScrapeConfigs: [
                    {
                        job_name: "kubernetes-pods",
                        honor_labels: true,
                        kubernetes_sd_configs: [{ role: "pod" }],
                        relabel_configs: [
                            {
                                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_scrape"],
                                action: "keep",
                                regex: "true",
                            },
                            {
                                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_path"],
                                action: "replace",
                                target_label: "__metrics_path__",
                                regex: "(.+)",
                            },
                            {
                                source_labels: [
                                    "__address__",
                                    "__meta_kubernetes_pod_annotation_prometheus_io_port",
                                ],
                                action: "replace",
                                regex: "([^:]+)(?::\\d+)?;(\\d+)",
                                replacement: "$1:$2",
                                target_label: "__address__",
                            },
                            {
                                action: "labelmap",
                                regex: "__meta_kubernetes_pod_label_(.+)",
                            },
                            {
                                source_labels: ["__meta_kubernetes_namespace"],
                                action: "replace",
                                target_label: "kubernetes_namespace",
                            },
                            {
                                source_labels: ["__meta_kubernetes_pod_name"],
                                action: "replace",
                                target_label: "kubernetes_pod_name",
                            },
                        ],
                    },
                ],
                resources: {
                    requests: { cpu: "250m", memory: "512Mi" },
                    limits: { cpu: "1", memory: "1Gi" },
                },
                retention: "7d",
                storageSpec: {
                    volumeClaimTemplate: {
                        spec: {
                            accessModes: ["ReadWriteOnce"],
                            resources: { requests: { storage: "10Gi" } },
                        },
                    },
                },
            },
        },
    },
}, { dependsOn: [monitoringNs] });

// ─────────────────────────────────────────────────────────────────────────────
// ServiceMonitors — Redis only (frontend has no metrics endpoint)
// ─────────────────────────────────────────────────────────────────────────────
const redisServiceMonitor = new k8s.apiextensions.CustomResource("redis-sm", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "guestbook-redis",
        namespace: monitoringNs.metadata.name,
        labels: { release: "prometheus" },
    },
    spec: {
        namespaceSelector: { matchNames: [appNs.metadata.name] },
        selector: { matchLabels: { app: "redis" } },
        endpoints: [{ port: "metrics", interval: "15s" }],
    },
}, { dependsOn: [prometheusRelease, redisLeaderService, redisFollowerService] });

// ─────────────────────────────────────────────────────────────────────────────
// Grafana Dashboard ConfigMap
// All queries use actual job/label names from Prometheus
// ─────────────────────────────────────────────────────────────────────────────
const dashboardJson = JSON.stringify({
    title: "Guestbook Application",
    uid: "guestbook-overview",
    schemaVersion: 38,
    refresh: "30s",
    time: { from: "now-1h", to: "now" },
    panels: [
        {
            id: 1,
            type: "stat",
            title: "Frontend Pods Up",
            gridPos: { x: 0, y: 0, w: 6, h: 4 },
            targets: [{
                expr: `count(kube_pod_status_ready{namespace="guestbook", condition="true"} == 1)`,
                legendFormat: "pods",
            }],
            fieldConfig: {
                defaults: {
                    color: { mode: "thresholds" },
                    thresholds: { steps: [{ color: "green", value: 0 }] },
                },
            },
        },
        {
            id: 2,
            type: "timeseries",
            title: "Network Receive Rate (frontend)",
            gridPos: { x: 6, y: 0, w: 18, h: 8 },
            targets: [{
                expr: `rate(container_network_receive_bytes_total{namespace="guestbook", pod=~"frontend.*"}[2m])`,
                legendFormat: "{{pod}}",
            }],
            fieldConfig: { defaults: { unit: "Bps" } },
        },
        {
            id: 3,
            type: "timeseries",
            title: "Redis Commands / sec",
            gridPos: { x: 0, y: 8, w: 12, h: 8 },
            targets: [{
                expr: `rate(redis_commands_processed_total{kubernetes_namespace="guestbook"}[2m])`,
                legendFormat: "{{kubernetes_pod_name}}",
            }],
            fieldConfig: { defaults: { unit: "ops" } },
        },
        {
            id: 4,
            type: "timeseries",
            title: "Redis Connected Clients",
            gridPos: { x: 12, y: 8, w: 12, h: 8 },
            targets: [{
                expr: `redis_connected_clients{kubernetes_namespace="guestbook"}`,
                legendFormat: "{{kubernetes_pod_name}}",
            }],
        },
        {
            id: 5,
            type: "timeseries",
            title: "Frontend CPU Usage",
            gridPos: { x: 0, y: 16, w: 12, h: 8 },
            targets: [{
                expr: `sum by(pod) (rate(container_cpu_usage_seconds_total{namespace="guestbook", container="php-redis"}[2m]))`,
                legendFormat: "{{pod}}",
            }],
            fieldConfig: { defaults: { unit: "cores" } },
        },
        {
            id: 6,
            type: "timeseries",
            title: "Frontend Memory Usage",
            gridPos: { x: 12, y: 16, w: 12, h: 8 },
            targets: [{
                expr: `sum by(pod) (container_memory_working_set_bytes{namespace="guestbook", container="php-redis"})`,
                legendFormat: "{{pod}}",
            }],
            fieldConfig: { defaults: { unit: "bytes" } },
        },
        {
            id: 7,
            type: "timeseries",
            title: "Redis Memory Used",
            gridPos: { x: 0, y: 24, w: 12, h: 8 },
            targets: [{
                expr: `redis_memory_used_bytes{kubernetes_namespace="guestbook"}`,
                legendFormat: "{{kubernetes_pod_name}}",
            }],
            fieldConfig: { defaults: { unit: "bytes" } },
        },
        {
            id: 8,
            type: "timeseries",
            title: "Redis Keyspace Hits vs Misses",
            gridPos: { x: 12, y: 24, w: 12, h: 8 },
            targets: [
                {
                    expr: `rate(redis_keyspace_hits_total{kubernetes_namespace="guestbook"}[2m])`,
                    legendFormat: "hits - {{kubernetes_pod_name}}",
                },
                {
                    expr: `rate(redis_keyspace_misses_total{kubernetes_namespace="guestbook"}[2m])`,
                    legendFormat: "misses - {{kubernetes_pod_name}}",
                },
            ],
            fieldConfig: { defaults: { unit: "ops" } },
        },
    ],
});

const grafanaDashboardCM = new k8s.core.v1.ConfigMap("grafana-dashboard-cm", {
    metadata: {
        name: "grafana-guestbook-dashboard",
        namespace: monitoringNs.metadata.name,
        labels: { grafana_dashboard: "1" },
    },
    data: { "guestbook-dashboard.json": dashboardJson },
}, { dependsOn: monitoringNs });

// ─────────────────────────────────────────────────────────────────────────────
// GRAFANA — Standalone Helm chart
// ─────────────────────────────────────────────────────────────────────────────
const grafanaRelease = new k8s.helm.v3.Release("grafana", {
    name: "grafana",
    chart: "grafana",
    version: "7.3.12",
    repositoryOpts: { repo: "https://grafana.github.io/helm-charts" },
    namespace: monitoringNs.metadata.name,
    cleanupOnFail: true,
    timeout: 600,
    values: {
        adminUser: "admin",
        adminPassword: grafanaAdminPassword,
        service: {
            type: "LoadBalancer",
            port: 80,
        },
        datasources: {
            "datasources.yaml": {
                apiVersion: 1,
                datasources: [
                    {
                        name: "Prometheus",
                        type: "prometheus",
                        url: "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090",
                        access: "proxy",
                        isDefault: true,
                    },
                ],
            },
        },
        sidecar: {
            dashboards: {
                enabled: true,
                label: "grafana_dashboard",
                searchNamespace: "monitoring",
            },
        },
        resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "500m", memory: "512Mi" },
        },
        persistence: {
            enabled: true,
            size: "2Gi",
            accessModes: ["ReadWriteOnce"],
        },
    },
}, { dependsOn: [monitoringNs, prometheusRelease, grafanaDashboardCM, metallbL2] });

// ─────────────────────────────────────────────────────────────────────────────
// Stack Outputs
// ─────────────────────────────────────────────────────────────────────────────
export const guestbookUrl = frontendService.status.apply(s => {
    const ing = s?.loadBalancer?.ingress?.[0];
    if (!ing) return "pending — run: kubectl get svc frontend -n guestbook";
    return `http://${ing.ip ?? ing.hostname}`;
});

export const grafanaAdminUser = "admin";
export const grafanaAdminPasswordOut = grafanaAdminPassword;
export const grafanaAccessNote = "kubectl port-forward -n monitoring svc/grafana 3000:80 → http://localhost:3000";
export const prometheusUrl = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090";
export const verifyScrapingCommand = "kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090 → http://localhost:9090/targets";
