// 弹窗层级管理:后打开的弹窗分配到更大的 z-index,保证多重弹窗按打开时序堆叠。
// 同时维护当前最高弹窗层级到 --reka-dialog-z,供 Select/Popover 等浮层参照,
// 避免它们被高层级弹窗盖住。

let current = 50
const openZIndices = new Set<number>()

function updateTopZ() {
  if (typeof document === 'undefined') return
  const top = openZIndices.size > 0 ? Math.max(...openZIndices) : 50
  document.documentElement.style.setProperty('--reka-dialog-z', String(top))
}

/** 弹窗打开时申请下一个 z-index */
export function nextZIndex(): number {
  const z = ++current
  openZIndices.add(z)
  updateTopZ()
  return z
}

/** 弹窗关闭/卸载时释放对应 z-index */
export function releaseZIndex(z: number) {
  openZIndices.delete(z)
  updateTopZ()
}
