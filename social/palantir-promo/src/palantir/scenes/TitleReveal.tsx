import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme, SAFE_X } from "../theme";
import { displayFont, bodyFont } from "../fonts";
import { TITLE_DURATION } from "../timeline";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export const TitleReveal: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const titleScale = interpolate(frame, [0, 22], [0.8, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const tagOpacity = interpolate(frame, [18, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const fadeOut = interpolate(frame, [TITLE_DURATION - 18, TITLE_DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
      }}
    >
      <Interactive.Div
        name="Title block"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          paddingInline: SAFE_X,
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            opacity: titleOpacity,
            scale: titleScale,
            background:
              `linear-gradient(135deg, transparent 46%, ${theme.parch3} 46% 54%, transparent 54%),` +
              `radial-gradient(circle at 50% 50%, ${theme.gold} 0 42%, #8c6420 43% 62%, transparent 63%)`,
            filter: "drop-shadow(0 0 16px rgba(240,200,96,0.55))",
          }}
        />
        <div
          style={{
            fontFamily: displayFont,
            fontSize: 100,
            letterSpacing: 4,
            color: theme.gold,
            textAlign: "center",
            opacity: titleOpacity,
            scale: titleScale,
            textShadow: `0 0 30px rgba(240,200,96,0.5), 4px 4px 0 ${theme.edge}`,
          }}
        >
          PALANTÍR
        </div>
        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 42,
            color: theme.parch2,
            textAlign: "center",
            maxWidth: 820,
            opacity: tagOpacity,
          }}
        >
          Tes agents Claude Code, vus depuis la Terre du Milieu
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
