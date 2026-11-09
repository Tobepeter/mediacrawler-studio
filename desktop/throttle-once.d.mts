export function throttleOnce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  options: { cooldown: number; burstGap?: number },
): ((...args: Args) => void) & { cancel(): void }
