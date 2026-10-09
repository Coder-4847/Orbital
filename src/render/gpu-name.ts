/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 4070" */
export function cleanGpuName(raw: string): string {
  const inner = raw.match(/^ANGLE \((.*)\)$/)?.[1] ?? raw;
  const parts = inner.split(', ');
  const model = parts.length > 1 ? parts[1]! : parts[0]!;
  return model.replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+Direct3D.*$/, '').trim();
}

/**
 * The graphics preset to start a first-time player on, from the renderer description ("WebGPU · nvidia blackwell",
 * "WebGL 2 · Intel(R) UHD Graphics"). Discrete GPUs get High; integrated or unknown ones Medium; software renderers Low.
 * Only a guess for the very first run: the player can change it in Settings, and it is never applied again.
 */
export function suggestPreset(label: string): 'low' | 'medium' | 'high' {
  const name = label.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|softpipe/.test(name)) return 'low';
  if (/nvidia|geforce|rtx|gtx|quadro/.test(name)) return 'high';
  if (/radeon rx|rdna|apple|\bm[1-9]\b|arc|xe-hpg/.test(name)) return 'high';
  return 'medium'; // Intel integrated, AMD APUs, mobile parts and anything unrecognised
}
