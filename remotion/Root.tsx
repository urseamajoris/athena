import { Composition } from "remotion";
import { CanvasDemo } from "./CanvasDemo";
import { StageExplainer } from "./StageExplainer";

export function Root() {
  return (
    <>
      <Composition id="CanvasDemo" component={CanvasDemo} durationInFrames={300} fps={30} width={1280} height={800} />
      {Array.from({ length: 9 }, (_, i) => (
        <Composition key={i} id={`Stage${i + 1}`} component={StageExplainer} defaultProps={{ stage: i + 1 }} durationInFrames={240} fps={30} width={1280} height={720} />
      ))}
    </>
  );
}
