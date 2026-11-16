import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme, SAFE_X } from "../theme";
import { displayFont, bodyFont } from "../fonts";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const useReveal = (delay: number) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const translate = interpolate(local, [0, 16], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  return { opacity, translate: `0 ${translate}px` };
};

export const CTA: React.FC = () => {
  const brand = useReveal(0);
  const cmd = useReveal(18);
  const repo = useReveal(34);
  const cta = useReveal(54);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Interactive.Div
        name="CTA block"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          paddingInline: SAFE_X,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontSize: 72,
            letterSpacing: 3,
            color: theme.gold,
            textShadow: `0 0 24px rgba(240,200,96,0.45), 3px 3px 0 ${theme.edge}`,
            opacity: brand.opacity,
            translate: brand.translate,
          }}
        >
          PALANTÍR
        </div>

        <div
          style={{
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 46,
            color: theme.gold,
            background: theme.wood,
            border: `3px solid ${theme.edge}`,
            borderRadius: 10,
            padding: "16px 34px",
            boxShadow: `0 6px 0 ${theme.edge}`,
            opacity: cmd.opacity,
            translate: cmd.translate,
          }}
        >
          npm start
        </div>

        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 34,
            color: theme.parch2,
            opacity: repo.opacity,
            translate: repo.translate,
          }}
        >
          github.com/WedooitScom/PALANTIR
        </div>

        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 44,
            color: theme.parch3,
            textAlign: "center",
            marginTop: 20,
            opacity: cta.opacity,
            translate: cta.translate,
          }}
        >
          👉 Lien dans la bio
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
