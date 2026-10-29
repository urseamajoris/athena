import { Composition } from "remotion";
import { CanvasDemo } from "./CanvasDemo";

export function Root() {
  return <Composition id="CanvasDemo" component={CanvasDemo} durationInFrames={300} fps={30} width={1280} height={800} />;
}
