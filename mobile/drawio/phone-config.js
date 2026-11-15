/**
 * The phone's `yaseen-render-config.js` (YAZ-5533), loaded BEFORE draw.io's viewer: every path the viewer could take
 * is this folder of the app's own site (`/drawio/<hash>/`), never viewer.diagrams.net. No proxy, no MathJax (maths
 * labels show their raw TeX on the phone), no resources, no stylesheets.
 */
(function()
{
	var base = new URL('.', window.location.href).href.replace(/\/$/, '');
	window.DRAWIO_BASE_URL = base;
	window.PROXY_URL = null;
	window.STYLE_PATH = base + '/styles';
	window.SHAPES_PATH = base + '/shapes';
	window.STENCIL_PATH = base + '/stencils';
	// Maths labels are left out on the phone (YAZ-5533): the viewer's MathJax start is an empty file of ours (`math/startup.js`),
	// so a maths label shows its raw TeX and nothing is asked of any host.
	window.DRAW_MATH_URL = base + '/math';
	window.GRAPH_IMAGE_PATH = base + '/img';
	window.mxImageBasePath = base + '/mxgraph/images';
	window.mxBasePath = base + '/mxgraph/';
	window.mxLoadResources = false;
	window.mxLoadStylesheets = false;
})();
