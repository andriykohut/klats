import type { ComponentProps, CSSProperties } from "react";
import type { Image } from "../../generated/testfmt";
import { MediaImage } from "../../rich/RichView";
import "./picture.css";

/**
 * A question's picture, scaled down to the space the sheet has left. Its box
 * has its final size from the first frame, so layout measured before the
 * file decodes stays right. Children are laid over the picture, positioned
 * against it; other props go to the box.
 */
export function Picture({
  image,
  className = "",
  children,
  ...props
}: { image: Image } & ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={`k-pic ${className}`}
      style={
        {
          aspectRatio: `${image.w} / ${image.h}`,
          "--img-w": `${image.w}px`,
          "--img-r": image.w / image.h,
        } as CSSProperties
      }
    >
      <MediaImage
        className="k-pic-img"
        src={image.src}
        w={image.w}
        h={image.h}
      />
      {children}
    </div>
  );
}
