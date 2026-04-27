import { handleError, main } from "./cli.js";

main(process.argv).catch(handleError);
