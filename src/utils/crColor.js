/**
 * Returns a hex color for a given Challenge Rating value.
 * CR 0–4:  green  (manageable)
 * CR 5–10: amber  (dangerous)
 * CR 11+:  red    (deadly)
 */
export const crColor = (cr) => {
  const n = parseFloat(
    String(cr)
      .replace('1/8', '0.125')
      .replace('1/4', '0.25')
      .replace('1/2', '0.5')
  )
  if (isNaN(n)) return '#6b6b6b'
  if (n <= 4)   return '#2D7A2D'   // green
  if (n <= 10)  return '#B8750A'   // amber
  return '#8B0000'                  // red
}
