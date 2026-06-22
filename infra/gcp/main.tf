# Minimal, real GCP target for Elevated Intelligence V2:
#   Cloud Run (the single-container app) + Cloud SQL (Postgres) +
#   Secret Manager (secrets) + Cloud Storage (ledger archives).
#
# It is deliberately small but executable: terraform apply with the required
# variables stands up a working environment. Schema migration and the demo seed
# are operational steps run against the provisioned database; see
# docs/migration-runbook.md.

locals {
  # The application reads DATABASE_URL from the environment directly (the pg
  # driver), so it is stored as a secret and injected as a secret env. It dials
  # Cloud SQL over the Unix socket the Cloud Run connection mounts at /cloudsql.
  database_url = "postgresql://${var.db_user}:${var.db_password}@/${var.db_name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
}

# The APIs this target uses. Left enabled on destroy so destroying this stack
# does not disable an API another stack in the same project depends on.
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# The runtime identity for the Cloud Run service. It is granted exactly the
# access the app needs and nothing more.
resource "google_service_account" "app" {
  account_id   = "${var.service_name}-run"
  display_name = "Elevated Intelligence V2 Cloud Run runtime"
}

# Cloud SQL: a single Postgres 16 instance, one database, one application user.
resource "google_sql_database_instance" "main" {
  name                = "${var.service_name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    ip_configuration {
      ipv4_enabled = false
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

# The archive bucket for provenance ledger archives (ARCHIVE_STORE_PROVIDER=gcs).
# Uniform access, versioned, and private.
resource "google_storage_bucket" "archives" {
  name                        = "${var.project_id}-${var.service_name}-archives"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket_iam_member" "app_archives" {
  bucket = google_storage_bucket.archives.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}

# Secrets. Each value is supplied at apply time and stored only in Secret
# Manager; the Cloud Run service account is granted read on each.
resource "google_secret_manager_secret" "session_secret" {
  secret_id = "SESSION_SECRET"
  replication {
    auto {}
  }
  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "session_secret" {
  secret      = google_secret_manager_secret.session_secret.id
  secret_data = var.session_secret
}

resource "google_secret_manager_secret" "owner_password" {
  secret_id = "OWNER_PASSWORD"
  replication {
    auto {}
  }
  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "owner_password" {
  secret      = google_secret_manager_secret.owner_password.id
  secret_data = var.owner_password
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "DATABASE_URL"
  replication {
    auto {}
  }
  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = local.database_url
}

# The app resolves SESSION_SECRET and OWNER_PASSWORD through the GCP SecretStore
# (SECRET_STORE_PROVIDER=gcp) using the metadata token of this service account,
# so it needs secretAccessor on those two. DATABASE_URL is read from the
# environment by the pg driver, so it is injected as a secret env below rather
# than fetched through the store.
resource "google_secret_manager_secret_iam_member" "session_secret" {
  secret_id = google_secret_manager_secret.session_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "owner_password" {
  secret_id = google_secret_manager_secret.owner_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# The runtime identity must be able to open the Cloud SQL socket.
resource "google_project_iam_member" "app_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# The Cloud Run service: the single-container app. Cloud Run injects PORT, which
# the api-server listens on; the image already sets PORTAL_DIST_DIR so the portal
# is served at "/". Secrets are resolved through the GCP SecretStore, and the
# Cloud SQL connection is mounted as a Unix socket volume.
resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region

  template {
    service_account = google_service_account.app.email

    # One always-on instance is the single loop runner. The seven in-process
    # scheduled loops (connector maintenance, alert notifier, retention purge,
    # backup archive, benchmark recompute, push morning brief, sftp drop watcher)
    # run once per instance with no cross-instance coordination, and each runs
    # only while its instance is alive, so the target pins exactly one instance
    # and keeps it warm. RATE_LIMIT_STORE=postgres below already shares the rate
    # limits (so they hold across the brief revision overlap during a rollout,
    # and so a future bump above one instance starts from a shared limit), but
    # scaling the request tier past one instance also needs a separate loop
    # runner or per-loop leader election. See docs/go-live-checklist.md.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = var.image

      env {
        name  = "SECRET_STORE_PROVIDER"
        value = "gcp"
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ARCHIVE_STORE_PROVIDER"
        value = "gcs"
      }
      env {
        name  = "GCS_ARCHIVE_BUCKET"
        value = google_storage_bucket.archives.name
      }
      # Route both rate-limit stores (the auth fixed window and the connector
      # token bucket) through the shared Postgres tables, so the limit holds
      # across the brief revision overlap during a rollout and a future
      # multi-instance request tier starts from a shared limit. The application
      # default stays "memory" for local and single-VM development.
      env {
        name  = "RATE_LIMIT_STORE"
        value = "postgres"
      }
      env {
        name  = "OWNER_EMAIL"
        value = var.owner_email
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8080
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.session_secret,
    google_secret_manager_secret_iam_member.owner_password,
    google_project_iam_member.app_cloudsql_client,
  ]
}

# Cloud Run invocation access. The application performs its own session-based
# authentication and authorization on every route, so platform-level invocation
# is intentionally public by default: without this binding the service URL would
# reject every browser and every unauthenticated request, the portal at "/" would
# be unreachable, and the GET /health smoke test in the runbook would fail. A
# public invoker grant exposes no tenant data, because authorization is still
# enforced at the application layer (tenant and admin routes are session-gated;
# health, static assets, public share links, webhooks, and MCP are intentionally
# public or key, token, and HMAC gated). Set allow_unauthenticated to false to make the service
# private at the platform edge instead, and front it with an authenticated path
# (IAP or an external load balancer that holds the run.invoker grant); the
# application's own auth is unchanged either way.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
