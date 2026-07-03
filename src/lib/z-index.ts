// 弹窗层级单调递增计数器:后打开的弹窗分配到更大的 z-index,
// 保证多重弹窗按打开时序堆叠,避免静态 z-index 导致后开的被先开的遮罩盖住。
// 不回收已释放的值——同时打开的弹窗数量有限,数值增长在 CSS 安全范围内。

let current = 50

/** 申请下一个 z-index,供弹窗打开时调用 */
export function nextZIndex(): number {
  return ++current
}
