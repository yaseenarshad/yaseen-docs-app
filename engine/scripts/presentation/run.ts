import "./runtimeEnvironment";

import {
  generatePresentationFiles,
  parsePresentationCliArguments,
} from "./generate";

const main = async () => {
  const options = parsePresentationCliArguments(process.argv.slice(2));
  const result = await generatePresentationFiles(options);
  process.stdout.write(
    `Generated ${result.report.slideCount} slides at ${result.outputPath}\nReport: ${result.reportPath}\n`,
  );
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
