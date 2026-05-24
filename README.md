# Guestbook Application with Prometheus & Grafana Monitoring

Extends the official [Pulumi Kubernetes Guestbook example](https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook/README.md) by adding a full observability stack using **Prometheus** and **Grafana**, all managed by Pulumi Infrastructure as Code (TypeScript).

---

## Architecture

```
kind Kubernetes Cluster (1 control-plane + 2 workers)
│
├── namespace: metallb-system
│   └── MetalLB (LoadBalancer IP provider for kind)
│
├── namespace: guestbook
│   ├── frontend          (3 replicas) ← php-redis app
│   ├── redis-leader      (1 replica)  ← redis + redis-exporter sidecar :9121
│   └── redis-follower    (2 replicas) ← redis + redis-exporter sidecar :9121
│
└── namespace: monitoring
    ├── Prometheus        (kube-prometheus-stack Helm chart)
    ├── Grafana           (grafana Helm chart) ← LoadBalancer
    ├── kube-state-metrics
    └── node-exporter (x3 — one per node)
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | Latest | https://www.docker.com/products/docker-desktop |
| kind | Latest | Bundled with Docker Desktop |
| Pulumi CLI | v3.x+ | `brew install pulumi` |
| Node.js + npm | v18.x+ | Via conda (see below) |
| kubectl | v1.28+ | `brew install kubectl` |
| Conda | Latest | https://docs.conda.io/en/latest/miniconda.html |

### Docker Desktop Resources
Settings → Resources:
- **CPU:** 4+
- **Memory:** 8 GB minimum

---

## Deploy Instructions

### Step 1 — Clone the repository

```bash
git clone https://github.com/yashshrivastav22/k8s-guestbook-monitoring.git
cd k8s-guestbook-monitoring
```

### Step 2 — Create kind cluster (1 master + 2 workers)

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
# guestbook-control-plane   Ready    control-plane   2m
# guestbook-worker          Ready    <none>          2m
# guestbook-worker2         Ready    <none>          2m
```

### Step 3 — Set up conda virtual environment

```bash
# Create conda environment with Node.js
conda create -n guestbook nodejs -y

# Activate the environment
conda activate guestbook

# Verify
node --version   # v18.x or higher
npm --version
```

### Step 4 — Install Node dependencies

```bash
npm install
```

### Step 5 — Login to Pulumi (local, no account needed)

```bash
pulumi login --local
```

### Step 6 — Initialize stack

```bash
pulumi stack init dev
```

### Step 7 — Set Grafana admin password

```bash
pulumi config set --secret grafanaAdminPassword 'Admin@123!'
```

### Step 8 — Verify Pulumi.dev.yaml has correct context

```bash
cat Pulumi.dev.yaml
```

Should show:
```yaml
config:
  kubernetes:context: kind-guestbook
```

### Step 9 — Deploy everything

```bash
pulumi up
```

Type **yes** when prompted. First deploy takes **5-10 minutes**.

> **Note:** If `pulumi up` errors on first run due to CRD timing, run it again.

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

### Prometheus

```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```
Open: **http://localhost:9090**

---

## Grafana Access URL and Admin Credentials

| Field | Value |
|-------|-------|
| URL | http://localhost:3000 |
| Username | `admin` |
| Password | value set in Step 7 |

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
OUTPUT                   VALUE
grafanaAccessNote        kubectl port-forward -n monitoring svc/grafana 3000:80
grafanaAdminPasswordOut  [secret]
grafanaAdminUser         admin
guestbookUrl             http://172.18.255.200
prometheusUrl            http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090
verifyScrapingCommand    kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

---

## How to Verify Guestbook Metrics are Being Scraped

### Method 1 — Prometheus Targets UI

```bash
kubectl port-forward -n monitoring \
  svc/prometheus-kube-prometheus-prometheus 9090:9090
```

Open **http://localhost:9090/targets**

Look for:
- `kubernetes-pods (3/3 up)` — Redis leader + 2 followers ✅

> **Note:** `kube-controller-manager`, `kube-etcd`, `kube-proxy`, `kube-scheduler` show DOWN on kind clusters — this is **expected and normal**. Our guestbook metrics are all UP.

### Method 2 — Query metrics in Prometheus

Open **http://localhost:9090** → Graph tab:

```promql
# Redis commands per second
rate(redis_commands_processed_total{kubernetes_namespace="guestbook"}[2m])

# Redis connected clients
redis_connected_clients{kubernetes_namespace="guestbook"}

# Frontend CPU usage
sum by(pod) (rate(container_cpu_usage_seconds_total{namespace="guestbook", container="php-redis"}[2m]))

# Frontend memory usage
sum by(pod) (container_memory_working_set_bytes{namespace="guestbook", container="php-redis"})
```

### Method 3 — Check raw Redis metrics

```bash
kubectl port-forward -n guestbook \
  $(kubectl get pod -n guestbook -l role=leader -o jsonpath='{.items[0].metadata.name}') \
  9121:9121

curl http://localhost:9121/metrics | grep redis_commands_processed
```

---

## Grafana Dashboard — "Guestbook Application"

Navigate to: **Dashboards → Browse → Guestbook Application**

| Panel | Metric | Description |
|-------|--------|-------------|
| Frontend Pods Up | `kube_pod_status_ready` | Count of healthy pods |
| Network Receive Rate | `container_network_receive_bytes_total` | Network traffic to frontend |
| Redis Commands/sec | `redis_commands_processed_total` | Redis operations per second |
| Redis Connected Clients | `redis_connected_clients` | Active Redis connections |
| Frontend CPU Usage | `container_cpu_usage_seconds_total` | CPU cores used by frontend |
| Frontend Memory Usage | `container_memory_working_set_bytes` | Memory used by frontend |
| Redis Memory Used | `redis_memory_used_bytes` | Redis memory consumption |
| Redis Keyspace Hits vs Misses | `redis_keyspace_hits_total` | Cache hit/miss ratio |

---

## MetalLB — LoadBalancer for kind

Since kind doesn't support cloud LoadBalancers, we use **MetalLB** to assign real IPs:

| Service | External IP |
|---------|------------|
| frontend (guestbook) | 172.18.255.200 |
| grafana (monitoring) | 172.18.255.201 |

> **Note:** These IPs are inside Docker's network. Use `kubectl port-forward` to access from your Mac browser.

---

## Tear Down

```bash
# Destroy all Kubernetes resources
pulumi destroy

# Delete the kind cluster
kind delete cluster --name guestbook
```

---

## Repository Structure

```
.
├── index.ts          # All Pulumi infrastructure code
├── Pulumi.yaml       # Project metadata
├── Pulumi.dev.yaml   # Dev stack config (kind-guestbook context)
├── package.json      # Node.js dependencies
├── tsconfig.json     # TypeScript config
├── .gitignore        # Excludes node_modules, bin, compiled files
└── README.md         # This file
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| kind with 3 nodes | Realistic multi-node cluster for local development |
| MetalLB | Provides real LoadBalancer IPs on kind (no cloud needed) |
| kube-prometheus-stack Helm chart | Installs Prometheus Operator + CRDs + extras in one shot |
| Grafana as separate Helm release | Independent upgrades; cleaner datasource/dashboard config |
| redis-exporter sidecar | Co-locates exporter with Redis; no separate DaemonSet needed |
| ServiceMonitor CRs | More robust than annotation-based scraping for Redis |
| Dashboard as ConfigMap | Grafana sidecar hot-loads dashboards — no manual import needed |
| Conda virtual env | Isolates Node.js/npm from system Python environment |
