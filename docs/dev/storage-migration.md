# Copo storage

Copo uses `~/.local/share/copo` on macOS and Linux, and `%APPDATA%\copo`
on Windows (falling back to `<home>\AppData\Roaming\copo`). An explicit
`COPILOT_API_HOME` or `--api-home` takes precedence and is never migrated.

Before importing config, logging, or SQLite, the CLI checks for the previous
`maximal` folder beside the new location. When Copo's folder does not exist,
it renames the complete legacy directory in place. Accounts, provider secrets,
configuration, usage databases and their side files, logs, language, and native
preferences retain their contents and permissions. Two existing stores are
never merged or overwritten.

The migration checks both the old PID file and session marker. If either
identifies a live process, quit that instance before launching the updated app.
It does not move a live database or kill a process to perform the migration.
An exclusive `.copo-storage-migration.lock` directory prevents concurrent
migrations; an interrupted migration may require inspecting the two folders
and removing the stale lock after confirming no migration is running.

The desktop shell calls the bundled CLI's `storage-path` command before reading
native preferences. Its JSON result supplies the shell's data directory, so
Reveal in Finder/Explorer, language, companion preferences, and the service use
the same location. A migration failure stops startup before native writes.
The installed shell and sidecar must be rebuilt together for this change.

The CLI is available as `copo`; the package retains `maximal` as a compatibility
alias. Existing internal protocol names and bundled sidecar filenames remain
compatible. Diagnostics and Logs display effective paths returned by the
service instead of example paths. Older services without this field show
Unknown until updated.

Tests use temporary directories and never migrate the developer's live store.
The focused checks are `storage-migration`, `paths`, `main-cli-global-options`,
`cli-path`, and `settings-api-diagnostics` tests.
