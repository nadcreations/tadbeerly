import localFont from "next/font/local";

/*
 * IBM Plex carries an engineering register that the usual interface faces do
 * not: it was drawn for technical documentation, and its mono companion is what
 * makes a column of ticket numbers scannable. Both load as CSS variables so the
 * two families can be mixed inside a single line.
 *
 * Self-hosted rather than fetched with next/font/google: that downloads from
 * Google at build time, and on Netlify Google served a font URL without a file
 * extension, which next/font cannot parse — the deploy failed. The files are the
 * Latin subsets from @fontsource/ibm-plex-* 5.3.0, under the SIL Open Font
 * Licence (./fonts/OFL.txt).
 */
export const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});
