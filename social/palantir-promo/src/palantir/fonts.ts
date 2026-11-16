import { loadFont as loadDisplay } from "@remotion/google-fonts/PressStart2P";
import { loadFont as loadBody } from "@remotion/google-fonts/VT323";

export const displayFont = loadDisplay("normal", {
  weights: ["400"],
  subsets: ["latin"],
}).fontFamily;

export const bodyFont = loadBody("normal", {
  weights: ["400"],
  subsets: ["latin"],
}).fontFamily;
