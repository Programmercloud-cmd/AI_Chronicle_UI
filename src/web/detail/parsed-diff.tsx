import { Diff, Hunk, type FileData } from "react-diff-view/esm";
import "react-diff-view/style/index.css";

function ParsedDiffFile({ file, index }: { file: FileData; index: number }) {
  const label = file.oldPath === file.newPath ? file.newPath : `${file.oldPath} -> ${file.newPath}`;
  return (
    <section className="diff-file" aria-labelledby={`diff-file-${index}`}>
      <h4 id={`diff-file-${index}`}>{label}</h4>
      {file.isBinary === true ? (
        <p>Binary patch content is available from the download link.</p>
      ) : (
        <div className="diff-scroll" tabIndex={0} aria-label={`Unified diff for ${label}`}>
          <Diff viewType="unified" diffType={file.type} hunks={file.hunks} gutterType="none">
            {(hunks) => hunks.map((hunk) => <Hunk key={`${hunk.oldStart}:${hunk.newStart}:${hunk.content}`} hunk={hunk} />)}
          </Diff>
        </div>
      )}
    </section>
  );
}

export function ParsedDiff({ evidenceId, files }: { evidenceId: string; files: FileData[] }) {
  return (
    <div className="actual-diff" aria-label={`Actual diff ${evidenceId}`}>
      {files.map((file, index) => (
        <ParsedDiffFile key={`${file.oldRevision}:${file.newRevision}:${file.oldPath}:${file.newPath}:${index}`} file={file} index={index} />
      ))}
    </div>
  );
}
