// ============================================================================
// Native adapter
// Abstracts capabilities that will have different implementations in:
//   - Web PWA (current)
//   - Capacitor iOS wrap (future, for App Store)
// When we add Capacitor, we swap the Web implementations for Capacitor plugin calls
// without touching any component code.
// ============================================================================

export type Platform = 'web' | 'ios' | 'android' | 'unknown';

export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown';
  if ((window as any).Capacitor) {
    return (window as any).Capacitor.getPlatform?.() || 'web';
  }
  return 'web';
}

export async function triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  if (typeof window === 'undefined') return;
  const Cap = (window as any).Capacitor;
  if (Cap?.isPluginAvailable?.('Haptics')) {
    const { Haptics, ImpactStyle } = (window as any).Haptics || {};
    try {
      await Haptics?.impact?.({ style: ImpactStyle[type.charAt(0).toUpperCase() + type.slice(1)] });
      return;
    } catch { /* fallthrough */ }
  }
  // Web fallback: vibration API (Android only; iOS Safari ignores)
  if (navigator.vibrate) {
    navigator.vibrate(type === 'light' ? 5 : type === 'medium' ? 15 : 25);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareText(text: string, title?: string): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share({ text, title });
      return true;
    } catch { /* user cancelled */ }
  }
  return copyToClipboard(text);
}
