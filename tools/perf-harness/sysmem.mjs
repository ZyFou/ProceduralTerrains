// Windows process + GPU memory sampler for the browser instance launched by the
// harness. Processes are matched by their unique --user-data-dir so concurrent
// browsers on the machine never pollute the numbers.
import { execFile } from 'node:child_process';

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000 },
      (error, stdout) => resolve(error ? null : stdout));
  });
}

export async function sampleBrowserMemory(profileDir) {
  if (process.platform !== 'win32') return null;
  const needle = profileDir.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') }
$out = @()
foreach ($p in $procs) {
  $type = 'browser'
  if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $Matches[1] }
  $gp = Get-Process -Id $p.ProcessId
  $dedicated = 0; $shared = 0
  if ($type -eq 'gpu-process') {
    $c = Get-Counter -Counter "\\GPU Process Memory(pid_$($p.ProcessId)*)\\Dedicated Usage","\\GPU Process Memory(pid_$($p.ProcessId)*)\\Shared Usage"
    foreach ($s in $c.CounterSamples) {
      if ($s.Path -like '*dedicated usage') { $dedicated += $s.CookedValue } else { $shared += $s.CookedValue }
    }
  }
  $out += [pscustomobject]@{ pid = $p.ProcessId; type = $type; privateBytes = $gp.PrivateMemorySize64; workingSet = $gp.WorkingSet64; cpuSeconds = $gp.CPU; gpuDedicated = $dedicated; gpuShared = $shared }
}
$out | ConvertTo-Json -Compress
`;
  const raw = await runPowerShell(script);
  if (!raw || !raw.trim()) return null;
  let list;
  try { list = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(list)) list = [list];
  const sum = (filter, key) => list.filter(filter).reduce((a, p) => a + (Number(p[key]) || 0), 0);
  return {
    processes: list.length,
    totalPrivateBytes: sum(() => true, 'privateBytes'),
    rendererPrivateBytes: sum((p) => p.type === 'renderer', 'privateBytes'),
    gpuProcessPrivateBytes: sum((p) => p.type === 'gpu-process', 'privateBytes'),
    gpuDedicatedBytes: sum((p) => p.type === 'gpu-process', 'gpuDedicated'),
    gpuSharedBytes: sum((p) => p.type === 'gpu-process', 'gpuShared'),
    rendererCpuSeconds: sum((p) => p.type === 'renderer', 'cpuSeconds'),
    gpuProcessCpuSeconds: sum((p) => p.type === 'gpu-process', 'cpuSeconds'),
  };
}
