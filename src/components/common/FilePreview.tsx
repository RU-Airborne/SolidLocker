import { useThumb } from "../../thumbs";
import { FileTypeIcon } from "./FileTypeIcon";

export function FilePreview({
  path,
  className = "fthumb",
}: {
  path: string;
  className?: string;
}) {
  const thumb = useThumb(path);
  return (
    <span className={className} aria-hidden="true">
      {thumb ? (
        <img src={thumb} alt="" draggable={false} />
      ) : (
        <FileTypeIcon path={path} />
      )}
    </span>
  );
}
