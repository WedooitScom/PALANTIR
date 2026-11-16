import { AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { theme, SAFE_X } from "../theme";
import { bodyFont } from "../fonts";
import { SHOT_DURATION } from "../timeline";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const Chip: React.FC<{ children: React.ReactNode; delay: number }> = ({ children, delay }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const translate = interpolate(local, [0, 16], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <div
      style={{
        fontFamily: bodyFont,
        fontSize: 40,
        color: theme.parch3,
        background: theme.wood,
        border: `2px solid ${theme.edge}`,
        borderRadius: 10,
        padding: "14px 26px",
        opacity,
        translate: `0 ${translate}px`,
        boxShadow: `0 6px 0 ${theme.edge}`,
      }}
    >
      {children}
    </div>
  );
};

export const ScreenshotShowcase: React.FC = () => {
  const frame = useCurrentFrame();

  const frameInOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const frameInScale = interpolate(frame, [0, 20], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const kenBurns = interpolate(frame, [0, SHOT_DURATION], [1, 1.07]);
  const fadeOut = interpolate(frame, [SHOT_DURATION - 18, SHOT_DURATION], [1, 0], {
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
        name="Screenshot block"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          paddingInline: SAFE_X,
        }}
      >
        <div
          style={{
            width: 860,
            borderRadius: 12,
            overflow: "hidden",
            border: `4px solid ${theme.edge}`,
            boxShadow: `0 14px 0 ${theme.edge}, 0 24px 48px rgba(0,0,0,0.5)`,
            opacity: frameInOpacity,
            scale: frameInScale,
          }}
        >
          <Img
            src={staticFile("screenshot.jpg")}
            style={{ width: "100%", display: "block", scale: kenBurns }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
          <Chip delay={40}>🔥 2 balises allumées</Chip>
          <Chip delay={72}>⚔️ Clique → file droit à la session</Chip>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
