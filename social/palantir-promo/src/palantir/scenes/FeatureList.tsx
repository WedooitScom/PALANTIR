import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme, SAFE_X } from "../theme";
import { bodyFont, displayFont } from "../fonts";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ITEM_SPAN = 27;
const ITEM_DURATION = 29;

const ROLES: { emoji: string; name: string; desc: string }[] = [
  { emoji: "🧙", name: "Magicien", desc: "réfléchit, lit le code" },
  { emoji: "⛏️", name: "Nain", desc: "écrit, édite les fichiers" },
  { emoji: "🏹", name: "Elfe éclaireur", desc: "explore, cherche" },
  { emoji: "🗿", name: "Troll", desc: "lance commandes et tests" },
];

const RoleCard: React.FC<{ item: (typeof ROLES)[number]; start: number }> = ({ item, start }) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const opacity = interpolate(local, [0, 8, 21, ITEM_DURATION], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const scale = interpolate(local, [0, 8], [0.88, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        opacity,
        scale,
      }}
    >
      <div style={{ fontSize: 150 }}>{item.emoji}</div>
      <div style={{ fontFamily: displayFont, fontSize: 48, color: theme.gold, textAlign: "center" }}>
        {item.name}
      </div>
      <div style={{ fontFamily: bodyFont, fontSize: 36, color: theme.parch2, textAlign: "center" }}>
        {item.desc}
      </div>
    </div>
  );
};

export const FeatureList: React.FC = () => {
  const frame = useCurrentFrame();
  const labelOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const totalDuration = ROLES.length * ITEM_SPAN + (ITEM_DURATION - ITEM_SPAN);
  const fadeOut = interpolate(frame, [totalDuration - 18, totalDuration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: fadeOut }}>
      <Interactive.Div
        name="Features"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 60,
          paddingInline: SAFE_X,
        }}
      >
        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 38,
            letterSpacing: 1,
            color: theme.inkSoft,
            textTransform: "uppercase",
            opacity: labelOpacity,
          }}
        >
          chaque sous-agent devient…
        </div>
        <div style={{ position: "relative", width: "100%", height: 320 }}>
          {ROLES.map((item, i) => (
            <RoleCard key={item.name} item={item} start={i * ITEM_SPAN} />
          ))}
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
