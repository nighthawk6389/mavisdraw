import type { MavisElement, SvgExportOptions } from '@mavisdraw/types';
import { renderSvgMarkup } from './svgMarkup.js';

/**
 * Export elements as the text of an SVG file.
 *
 * The same renderer as embeds and README images: everything taken from the
 * diagram (colours, numbers, labels, image data) is validated or escaped, so
 * a shape's colour or text can't put markup, or script, into the file. A
 * teammate's edit is in every export, so it mustn't be able to.
 */
export function exportToSvg(
  elements: MavisElement[],
  options: SvgExportOptions,
  backgroundColor?: string,
): string {
  return renderSvgMarkup(elements, {
    padding: options.padding,
    renderMode: options.renderMode,
    background: options.includeBackground && !!backgroundColor,
    backgroundColor,
  });
}
