#!/bin/bash
# Runs once, on first DB init (empty data dir), via docker-entrypoint-initdb.d.
set -e
pg_restore -U postgres -d postgres --no-owner --clean --if-exists /snapshot/wcl-snapshot.dump
