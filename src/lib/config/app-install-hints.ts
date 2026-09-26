/** Shared by detection responses and the installation-help dialog. */
export function claudeCodeInstallHint(windows: boolean) {
  return windows ?
      {
        method: "powershell",
        command: "irm https://claude.ai/install.ps1 | iex",
      }
    : {
        method: "bash",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      }
}
