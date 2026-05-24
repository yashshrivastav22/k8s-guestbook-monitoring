# Guestbook Application with Prometheus & Grafana Monitoring

Extends the official [Pulumi Kubernetes Guestbook example](https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook/README.md) by adding a full observability stack using **Prometheus** and **Grafana**, all managed by Pulumi.

---

## Architecture

```
kind Kubernetes Cluster
│
├── namespace: guestbook
│   ├── frontend          (3 replicas) ← php-redis + nginx-exporter sidecar :9113
│   ├── redis-leader      (1 replica)  ← redis + redis-exporter sidecar :9121
│   └── redis-follower    (2 replicas) ← redis + redis-exporter sidecar :9121
│
└── namespace: monitoring
    ├── Prometheus        (kube-prometheus-stack Helm chart)
    ├── Grafana           (grafana Helm chart) ← LoadBalancer
    ├── kube-state-metrics
    └── node-exporter
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Pulumi CLI | v3.x+ |
| Node.js | v18.x+ |
| kubectl | v1.28+ |
| kind cluster | 1 control-plane + 2 workers |

---

## Deploy Instructions

### Step 1 — Clone the repository

```bash
git clone https://github.com/<your-username>/k8s-guestbook-monitoring.git
cd k8s-guestbook-monitoring
```

### Step 2 — Create kind cluster (if not already done)

```bash
cat > kind-guestbook.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: guestbook
nodes:
  - role: control-plane
  - role: worker
  - role: worker
EOF

kind create cluster --config kind-guestbook.yaml
```

Verify:
```bash
kubectl get nodes
# NAME                      STATUS   ROLES           AGE
# guestbook-control-plane   Ready    control-plane   1m
# guestbook-worker          Ready    <none>          1m
# guestbook-worker2         Ready    <none>          1m
```

### Step 3 — Install dependencies

```bash
npm install
```

### Step 4 — Login to Pulumi (local, no account needed)

```bash
pulumi login --local
```

### Step 5 — Initialize stack

```bash
pulumi stack init dev
```

### Step 6 — Set Grafana admin password

```bash
pulumi config set --secret grafanaAdminPassword 'Admin@123!'
```

### Step 7 — Deploy everything

```bash
pulumi up
```

Type **yes** when prompted. First deploy takes **5–10 minutes** (downloads Helm charts + container images).

> **Note:** If `pulumi up` errors on first run due to CRD timing, run it again — it will complete successfully.

---

## Accessing the Applications

### Guestbook Frontend

```bash
kubectl port-forward -n guestbook svc/frontend 8080:80
```
Open: **http://localhost:8080**

### Grafana

```bash
kubectl port-forward -n monitoring svc/grafana 3000:80
```
Open: **http://localhost:3000**

---

## Grafana Access URL and Admin Credentials

| Field | Value |
|-------|-------|
| URL | http://localhost:3000 |
| Username | `admin` |
| Password | the value you set in Step 6 |

Retrieve password anytime:
```bash
pulumi stack output grafanaAdminPasswordOut --show-secrets
```

---

## Pulumi Stack Outputs

```bash
pulumi stack output
```

```
guestbookUrl            = pending — run: kubectl get svc frontend -n guestbook
grafanaAdminUser        = admin
grafanaAdminPasswordOut = [secret]
grafanaAccessUrl        = Use: kubectl port-forward -n monitoring svc/grafana 3000:80
prometheusUrl           = http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090
verifyScrapingCommand   = kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

---

## How to Verify Guestbook Metrics are Being Scraped

### Method 1 — Prometheus Targets UI

```bash
kubectl port-forward -n monitoring \
  svc/prometheus-kube-prometheus-prometheus 9090:9090
```

Open **http://localhost:9090/targets**

Look for these targets with state **UP**:
- `serviceMonitor/monitoring/guestbook-frontend`
- `serviceMonitor/monitoring/guestbook-redis`

### Method 2 — Query metrics in Prometheus

Open **http://localhost:9090** → Graph tab and run:

```promql
# Frontend HTTP request rate
rate(nginx_http_requests_total{kubernetes_namespace="guestbook"}[2m])

# Redis commands per second
rate(redis_commands_processed_total{kubernetes_namespace="guestbook"}[2m])

# Frontend pod CPU usage
sum by(pod) (rate(container_cpu_usage_seconds_total{namespace="guestbook"}[2m]))
```

### Method 3 — Check raw metrics endpoints

```bash
# Frontend metrics
kubectl port-forward -n guestbook \
  $(kubectl get pod -n guestbook -l tier=frontend -o jsonpath='{.items[0].metadata.name}') \
  9113:9113

curl http://localhost:9113/metrics | grep nginx_http_requests
```

```bash
# Redis metrics
kubectl port-forward -n guestbook \
  $(kubectl get pod -n guestbook -l role=leader -o jsonpath='{.items[0].metadata.name}') \
  9121:9121

curl http://localhost:9121/metrics | grep redis_commands_processed
```

---

## Grafana Dashboard

The **"Guestbook Application"** dashboard is auto-provisioned.

Navigate to: **Dashboards → Browse → Guestbook Application**

| Panel | Metric |
|-------|--------|
| Frontend Pods Up | Count of healthy frontend pods |
| HTTP Request Rate | nginx requests/sec per pod |
| Redis Commands/sec | Redis operations per second |
| Redis Connected Clients | Active Redis connections |
| Frontend CPU Usage | CPU cores used by php-redis container |
| Frontend Memory Usage | Memory used by php-redis container |
| Redis Memory Used | Redis memory consumption |
| Redis Replication Lag | Replication backlog size |

---

## Tear Down

```bash
pulumi destroy
```

Delete the kind cluster:
```bash
kind delete cluster --name guestbook
```

---

## Repository Structure

```
.
├── index.ts          # All Pulumi infrastructure code
├── Pulumi.yaml       # Project metadata
├── Pulumi.dev.yaml   # Dev stack config
├── package.json      # Node.js dependencies
├── tsconfig.json     # TypeScript config
├── .gitignore
└── README.md
```
