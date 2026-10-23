import { useMediaURL } from "@klats/shared/media.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { MediaImage } from "@klats/shared/rich/RichView.tsx";
import { AudioPlayer } from "@klats/shared/student-ui/AudioPlayer.tsx";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import type { ReactNode } from "react";

/** A media block in the editor with a × that removes it from the text. */
function Frame(props: { deleteNode: () => void; children: ReactNode }) {
  return (
    <NodeViewWrapper className="b-media" contentEditable={false}>
      {props.children}
      <button
        type="button"
        className="b-media-x"
        aria-label={m.rich_media_remove()}
        onClick={props.deleteNode}
      >
        ×
      </button>
    </NodeViewWrapper>
  );
}

/** The node view of an image block: the picture as students see it. */
export function ImageView({ node, deleteNode }: NodeViewProps) {
  const { src, w, h } = node.attrs;
  return (
    <Frame deleteNode={deleteNode}>
      <MediaImage src={src} w={w} h={h} className="b-media-img" />
    </Frame>
  );
}

/** The node view of an audio block: the player students get. */
export function AudioView({ node, deleteNode }: NodeViewProps) {
  const url = useMediaURL(node.attrs.src);
  return (
    <Frame deleteNode={deleteNode}>
      <AudioPlayer src={url} />
    </Frame>
  );
}
