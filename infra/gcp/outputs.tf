output "service_url" {
  description = "The URL of the deployed Cloud Run service. Reachable by browsers when allow_unauthenticated is true (the default, via the roles/run.invoker grant to allUsers); when false the service is private at the platform edge and requires an authenticated front door."
  value       = google_cloud_run_v2_service.app.uri
}

output "cloud_sql_connection_name" {
  description = "The Cloud SQL instance connection name (PROJECT:REGION:INSTANCE), used by the Cloud SQL Auth Proxy for migrations and by the Cloud Run socket mount."
  value       = google_sql_database_instance.main.connection_name
}

output "archive_bucket" {
  description = "The GCS bucket that holds provenance ledger archives (GCS_ARCHIVE_BUCKET)."
  value       = google_storage_bucket.archives.name
}

output "runtime_service_account" {
  description = "The email of the Cloud Run runtime service account."
  value       = google_service_account.app.email
}
