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
| Node.js + npm | v18.x+ | Via conda (see Step 3) |
| kubectl | v1.28+ | `brew install kubectl` |
| Conda | Latest | https://docs.conda.io/en/latest/miniconda.html |

### Docker Desktop Resources
Before starting, make sure Docker Desktop has enough resources:
- **Settings → Resources → CPU:** 4+
- **Settings → Resources → Memory:** 8 GB minimum

---

## Step-by-Step Deploy Instructions

### Step 1 — Clone the repository

```bash
git clone https://github.com/yashshrivastav22/k8s-guestbook-monitoring.git
cd k8s-guestbook-monitoring
```

### Step 2 — Create kind cluster (1 master + 2 workers)

Create the cluster config file:
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
```

Create the cluster:
```bash
kind create cluster --config kind-guestbook.yaml
```

This takes 2-3 minutes. Verify cluster is ready:
```bash
kubectl get nodes
```

Expected output:
```
NAME                      STATUS   ROLES           AGE   VERSION
guestbook-control-plane   Ready    control-plane   2m    v1.35.0
guestbook-worker          Ready    <none>          2m    v1.35.0
guestbook-worker2         Ready    <none>          2m    v1.35.0
```

Verify correct context is active:
```bash
kubectl config current-context
# Should print: kind-guestbook
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

> **Note:** Pulumi CLI is installed globally on your Mac, not inside conda.

### Step 4 — Install Node dependencies

```bash
npm install
```

Expected output:
```
added 234 packages, and audited 235 packages
found 0 vulnerabilities
```

### Step 5 — Login to Pulumi (local, no account needed)

```bash
pulumi login --local
```

Expected output:
```
Logged in to Mac.lan as <yourname> (file://~)
```

### Step 6 — Initialize Pulumi stack

```bash
pulumi stack init dev
```

> **Important:** You will be asked to enter a **passphrase**. This protects your secrets (like the Grafana password). Choose any passphrase and **remember it** — you will need it every time you run `pulumi up`.

Verify stack was created:
```bash
pulumi stack ls
```

Expected:
```
NAME  LAST UPDATE  RESOURCE COUNT
dev*  n/a          0
```

### Step 7 — Verify Pulumi.dev.yaml has correct context

```bash
cat Pulumi.dev.yaml
```

Should show:
```yaml
config:
  kubernetes:context: kind-guestbook
```

If the context is different, update it:
```bash
nano Pulumi.dev.yaml
# Change kubernetes:context to: kind-guestbook
# Save: Ctrl+X → Y → Enter
```

### Step 8 — Set Grafana admin password

```bash
pulumi config set --secret grafanaAdminPassword 'Admin@123!'
```

> **Note:** You will be asked for your passphrase from Step 6. You can use any password you like — just remember it for Grafana login.

### Step 9 — Deploy everything

```bash
pulumi up
```

- Enter your **passphrase** when prompted
- Review the preview of resources
- Type **yes** to deploy

> ⏱ First deploy takes **5-10 minutes** — it downloads Helm charts and container images. This is normal.

> ⚠️ **If `pulumi up` fails on first run** with a CRD error, just run `pulumi up` again. This is a known timing issue with CRD installation that resolves on the second run.

### Step 10 — Verify deployment

```bash
# Check all pods are running
kubectl get pods -n guestbook
kubectl get pods -n monitoring

# Check services have IPs
kubectl get svc -n guestbook
kubectl get svc -n monitoring
```

Expected pods in guestbook namespace:
```
NAME                             READY   STATUS    RESTARTS
frontend-xxxxx                   1/1     Running   0
frontend-xxxxx                   1/1     Running   0
frontend-xxxxx                   1/1     Running   0
redis-leader-xxxxx               2/2     Running   0
redis-follower-xxxxx             2/2     Running   0
redis-follower-xxxxx             2/2     Running   0
```

Expected pods in monitoring namespace:
```
NAME                                                   READY   STATUS
grafana-xxxxx                                          2/2     Running
prometheus-kube-prometheus-operator-xxxxx              1/1     Running
prometheus-kube-state-metrics-xxxxx                    1/1     Running
prometheus-prometheus-kube-prometheus-prometheus-0     2/2     Running
prometheus-prometheus-node-exporter-xxxxx              1/1     Running
prometheus-prometheus-node-exporter-xxxxx              1/1     Running
prometheus-prometheus-node-exporter-xxxxx              1/1     Running
```

---

## Accessing the Applications

Open **three terminal tabs** and run one command in each:

### Terminal 1 — Guestbook App
```bash
kubectl port-forward -n guestbook svc/frontend 8080:80
```
Open: **http://localhost:8080**

### Terminal 2 — Grafana
```bash
kubectl port-forward -n monitoring svc/grafana 3000:80
```
Open: **http://localhost:3000**

### Terminal 3 — Prometheus
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
| Password | value you set in Step 8 |

Retrieve password anytime:
```bash
pulumi stack output grafanaAdminPasswordOut --show-secrets
```

If you can't login, reset the password:
```bash
kubectl exec -n monitoring \
  $(kubectl get pod -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].metadata.name}') \
  -c grafana -- grafana-cli admin reset-admin-password Admin@123!
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

Open **http://localhost:9090/targets**

Look for `kubernetes-pods (3/3 up)`:
- redis-leader :9121 → **UP** ✅
- redis-follower :9121 → **UP** ✅
- redis-follower :9121 → **UP** ✅

> **Note:** `kube-controller-manager`, `kube-etcd`, `kube-proxy`, `kube-scheduler` show **DOWN** on kind clusters. This is **completely normal** — kind doesn't expose these internal ports. Only our guestbook Redis metrics matter and they are all UP.

### Method 2 — Query metrics in Prometheus

Open **http://localhost:9090** → Graph tab and run:

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

### Method 3 — Check raw Redis metrics endpoint

```bash
kubectl port-forward -n guestbook \
  $(kubectl get pod -n guestbook -l role=leader -o jsonpath='{.items[0].metadata.name}') \
  9121:9121
```

```bash
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

> **Tip:** If panels show "No data", wait 2-3 minutes for Prometheus to collect metrics, then refresh.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pulumi up` fails first time | Run `pulumi up` again — CRD timing issue |
| Pods stuck in `Pending` | Increase Docker Desktop memory to 8GB |
| `kind-guestbook` context not found | Run `kubectl config get-contexts` and update `Pulumi.dev.yaml` |
| Grafana dashboard shows "No data" | Wait 2-3 minutes for metrics to collect |
| Can't login to Grafana | Run the password reset command above |
| Port already in use | Change local port: `8081:80` instead of `8080:80` |
| MetalLB IPs not reachable from browser | Use `kubectl port-forward` instead |

---

## MetalLB — LoadBalancer for kind

Since kind doesn't support cloud LoadBalancers natively, we deploy **MetalLB** to assign real IPs from Docker's internal network:

| Service | External IP |
|---------|------------|
| frontend (guestbook) | 172.18.255.200 |
| grafana (monitoring) | 172.18.255.201 |

> **Note:** These IPs are inside Docker's network and are not reachable directly from your Mac browser. Use `kubectl port-forward` to access the applications.

---

## Tear Down

```bash
# Destroy all Kubernetes resources managed by Pulumi
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
| kube-prometheus-stack Helm chart | Installs Prometheus Operator + CRDs + kube-state-metrics + node-exporter in one shot |
| Grafana as separate Helm release | Independent upgrades; cleaner datasource/dashboard config |
| redis-exporter sidecar | Co-locates exporter with Redis; no separate DaemonSet needed |
| ServiceMonitor CRs | More robust than annotation-based scraping for Redis |
| Dashboard as ConfigMap | Grafana sidecar hot-loads dashboards — no manual import needed |
| Conda virtual env | Isolates Node.js/npm from system Python environment |
| Pulumi local backend | No Pulumi account needed — state stored locally |
