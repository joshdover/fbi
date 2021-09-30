export const range = (x: number): number[] => {
  const r = [];
  for (let i = Math.abs(x); i > 0; i--) {
    r.push(i);
  }
  return r;
};
