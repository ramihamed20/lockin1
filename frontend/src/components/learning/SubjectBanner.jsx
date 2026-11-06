import "./subject-banner.css";

const artwork = [
  [/embryo/, "embryology"],
  [/histo/, "histology"],
  [/physio/, "physiology"],
  [/biochem|chemistry/, "biochemistry"],
  [/micro/, "microbiology"],
  [/pharm/, "pharmacy"],
  [/patho/, "pathology"],
  [/remov/, "removable-prosthodontic"],
  [/fixed|prostho/, "fixed-prosthodontic"],
  [/conserv/, "conservative"],
  [/dental[- ]materials?/, "dental-material"],
  [/dental|tooth|oral/, "dental-anatomy"],
  [/anatom/, "anatomy"],
  [/english/, "english"],
  [/(?:^|[-\s])it(?:$|[-\s])|comput/, "it"],
];

export function SubjectBanner({ material, variant = "banner" }) {
  const subject = `${material?.slug || ""} ${material?.title || ""}`.toLowerCase();
  const key = artwork.find(([pattern]) => pattern.test(subject))?.[1] ?? "study";

  return (
    <img
      className="subject-banner-art"
      src={`${import.meta.env.BASE_URL}subject-art/${key}.webp`}
      alt=""
      loading={variant === "cover" ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
