// @ts-nocheck

export const loadMathType = async () => {
  await import("@wiris/mathtype-generic/styles.css");
  await import("@wiris/mathtype-generic/wirisplugin-generic.js");
};
