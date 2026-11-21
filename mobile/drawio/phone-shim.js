/**
 * THE PHONE'S SHIM (YAZ-5533), loaded AFTER draw.io's `viewer-static.min.js` and `phone-index.js`, and BEFORE the Mac's
 * `yaseen-links.js` and `yaseen-render.js`, which run unchanged. It does four things the phone needs and the Mac does not:
 *
 * 1. SHAPE LIBRARIES ON DEMAND. The Mac loads every stencil set at once (`stencils.min.js`, 7.7 MB). The phone ships one
 *    file per library (`stencils/<library>.js`, written by `publish/drawioPhone.ts`). Before the Mac's renderer sees a
 *    request, a short pass reads the shape names in its XML (inside compressed pages too) and loads only those
 *    libraries. A library that cannot load (no signal, the first time) draws as a placeholder box that says so, and
 *    the answer says which were missing, so the app can draw it again when the signal comes back.
 * 2. FONTS ON DEMAND, with NO network: the Mac's draw.io fonts (Inter, Roboto, Assistant, IBM Plex Mono, Liberation
 *    Serif), one script per family (`fonts/<Family>.js`, the woff2 bytes), loaded only when the diagram names the
 *    family. They are added for measuring (`FontFace`) and handed to the Mac's embed step as draw.io's resolved font
 *    CSS, in the Mac's order, so the picture carries the same faces as on the Mac.
 * 3. NO NETWORK: `fetch` answers "not there" without asking anyone (the Mac's renderer asks for its font sheet; the
 *    phone gives the fonts above instead). The frame's CSP (`connect-src 'none'`) refuses any other call anyway.
 * 4. NO STORAGE: the frame's own window loses IndexedDB, local and session storage, Cache Storage, cookies, the
 *    service worker and `window.open`. The viewer needs none of them. (A same-origin frame can still reach its parent;
 *    the walls against that are draw.io's label sanitising, and the frame's CSP, under which no injected HTML can
 *    run a script: `script-src 'self'`, no inline script, no eval.)
 */
(function()
{
	'use strict';

	var index = window.__yaseenDrawioIndex || {stencils: {}, fonts: []};
	var stencilText = window.__stencils = window.__stencils || {};
	var fontFaces = window.__yaseenFonts = window.__yaseenFonts || {};

	// ---- 1. Shape libraries --------------------------------------------------------------------------------------

	/** draw.io asks a library by its path under STENCIL_PATH: the phone answers from the library's loaded script, never XHR. */
	mxStencilRegistry.loadStencil = function(filename, fn)
	{
		var key = filename.substring(STENCIL_PATH.length + 1);
		var text = stencilText[key];
		var xml = null;

		if (text != null)
		{
			xml = pako.inflateRaw(Uint8Array.from(atob(text), function(c)
			{
				return c.charCodeAt(0);
			}), {to: 'string'});
		}

		if (fn != null)
		{
			window.setTimeout(function()
			{
				fn((xml != null) ? mxUtils.parseXml(xml) : null);
			}, 0);
		}
		else
		{
			return (xml != null) ? mxUtils.parseXml(xml) : null;
		}
	};

	/** The placeholder of a shape whose library is not on the phone yet: a dashed box with a short note. */
	var PLACEHOLDER = '<shape name="yaseen.placeholder" w="100" h="100" aspect="variable" strokewidth="1">' +
		'<background><strokecolor color="#999999"/><fillcolor color="#f5f5f5"/><dashed dashed="1"/>' +
		'<rect x="0" y="0" w="100" h="100"/><fillstroke/></background>' +
		'<foreground><fontcolor color="#666666"/><fontsize size="8"/>' +
		'<text str="This shape set downloads" x="50" y="36" align="center" valign="middle"/>' +
		'<text str="the first time" x="50" y="50" align="center" valign="middle"/>' +
		'<text str="you\'re online" x="50" y="64" align="center" valign="middle"/></foreground></shape>';
	var placeholder = null;
	/** Each shape name drawn as the placeholder now, with its library. */
	var placeheld = {};

	/** The XML of the request and of each compressed page in it: where the shape and font names are. */
	function textsOf(xml)
	{
		var texts = [xml];

		try
		{
			var diagrams = mxUtils.parseXml(xml).getElementsByTagName('diagram');

			for (var i = 0; i < diagrams.length; i++)
			{
				if (diagrams[i].firstElementChild == null && diagrams[i].textContent.trim() != '')
				{
					texts.push(Graph.decompress(diagrams[i].textContent));
				}
			}
		}
		catch (e)
		{
			// Not a diagram: the renderer says so in its answer.
		}

		return texts.join('\n');
	}

	/** The library files (`aws4.xml`) the shape names of `text` need, each with the names it draws. */
	function librariesOf(text)
	{
		var names = {};
		var re = /mxgraph\.[a-z0-9_.]+/gi;
		var m;

		while ((m = re.exec(text)) != null)
		{
			names[m[0]] = 1;
		}

		var libs = {};

		Object.keys(names).forEach(function(name)
		{
			var base = mxStencilRegistry.getBasenameForStencil(name);

			if (base == null)
			{
				return;
			}

			var files = mxStencilRegistry.libraries[base];
			(files != null ? files : [STENCIL_PATH + '/' + base.replace('_-_', '_') + '.xml']).forEach(function(url)
			{
				if (!/\.xml$/i.test(url))
				{
					return;
				}

				var key = url.substring(STENCIL_PATH.length + 1);

				if (index.stencils[key] != null)
				{
					(libs[key] = libs[key] || []).push(name);
				}
			});
		});

		return libs;
	}

	/** Loads one script of this folder; resolves true when it ran. */
	function script(src)
	{
		return new Promise(function(resolve)
		{
			var s = document.createElement('script');
			s.src = src;
			s.onload = function()
			{
				resolve(true);
			};
			s.onerror = function()
			{
				s.remove();
				resolve(false);
			};
			document.head.appendChild(s);
		});
	}

	/** The libraries of `text`, loaded; resolves with the ones that could not load (no signal, the first time). */
	function loadLibraries(text)
	{
		var libs = librariesOf(text);
		var keys = Object.keys(libs);

		return Promise.all(keys.map(function(key)
		{
			return (stencilText[key] != null) ? Promise.resolve(true) : script('stencils/' + index.stencils[key]);
		})).then(function(loaded)
		{
			var missing = [];
			var cameBack = false;

			keys.forEach(function(key, i)
			{
				if (loaded[i] && stencilText[key] != null)
				{
					// A library that was a placeholder before: its real shapes from now on.
					Object.keys(placeheld).forEach(function(name)
					{
						if (placeheld[name] == key)
						{
							delete mxStencilRegistry.stencils[name];
							delete placeheld[name];
							cameBack = true;
						}
					});

					return;
				}

				missing.push(key);

				if (placeholder == null)
				{
					placeholder = new mxStencil(mxUtils.parseXml(PLACEHOLDER).documentElement);
				}

				libs[key].forEach(function(name)
				{
					[name, name.toLowerCase()].forEach(function(n)
					{
						if (mxStencilRegistry.stencils[n] == null || placeheld[n] != null)
						{
							mxStencilRegistry.stencils[n] = placeholder;
							placeheld[n] = key;
						}
					});
				});
			});

			if (cameBack)
			{
				// Each library is read again when a shape asks for it (the ones loaded since).
				mxStencilRegistry.packages = {};
				mxStencilRegistry.filesLoaded = {};
			}

			return missing;
		});
	}

	// ---- 2. Fonts ------------------------------------------------------------------------------------------------

	/** The resolved font CSS of the families loaded so far, in the Mac's order (`yaseen-fonts/fonts.css`). */
	var fontCss = '';

	function bytesOf(b64)
	{
		return Uint8Array.from(atob(b64), function(c)
		{
			return c.charCodeAt(0);
		}).buffer;
	}

	function loadFonts(text)
	{
		var wanted = index.fonts.filter(function(font)
		{
			return fontFaces[font[0]] == null && text.indexOf(font[0]) >= 0;
		});

		return Promise.all(wanted.map(function(font)
		{
			return script('fonts/' + font[1]).then(function(ok)
			{
				var faces = ok ? fontFaces[font[0]] : null;

				return Promise.all((faces || []).map(function(face)
				{
					try
					{
						var f = new FontFace(font[0], bytesOf(face.b64), {weight: String(face.weight), style: 'normal'});
						document.fonts.add(f);
						return f.load().catch(function() {});
					}
					catch (e)
					{
						return null;
					}
				}));
			});
		})).then(function()
		{
			var rules = [];

			index.fonts.forEach(function(font)
			{
				(fontFaces[font[0]] || []).forEach(function(face)
				{
					rules.push('@font-face { font-family: \'' + font[0] + '\'; src: url(\'data:font/woff2;base64,' + face.b64 +
						'\') format(\'woff2\'); font-weight: ' + face.weight + '; font-style: normal; font-display: swap; }');
				});
			});

			fontCss = rules.join('\n');
		});
	}

	/** draw.io's door to the fonts it embeds in a picture: the phone's loaded faces, as data URIs, with no fetch. */
	Editor.prototype.loadFonts = function(done)
	{
		this.resolvedFontCss = fontCss;

		if (done != null)
		{
			done();
		}
	};

	// ---- The request: its libraries and fonts first, then the Mac's renderer -------------------------------------

	var passing = null;

	window.addEventListener('message', function(evt)
	{
		if (evt.data === passing)
		{
			passing = null;
			return;
		}

		if (evt.source !== window.parent || typeof evt.data !== 'string')
		{
			return;
		}

		var req = null;

		try
		{
			req = JSON.parse(evt.data);
		}
		catch (e)
		{
			return;
		}

		if (req == null || typeof req.id !== 'string' || typeof req.xml !== 'string')
		{
			return;
		}

		evt.stopImmediatePropagation();
		var data = evt.data;
		var text = textsOf(req.xml);

		Promise.all([loadLibraries(text), loadFonts(text)]).then(function(done)
		{
			// The app learns which libraries were placeholders (it draws the diagram again online).
			window.parent.postMessage(JSON.stringify({event: 'shapes', id: req.id, missing: done[0]}), window.location.origin);
			passing = data;
			window.dispatchEvent(new MessageEvent('message', {data: data, source: window.parent, origin: window.location.origin}));
		});
	}, true);

	// ---- 3 and 4. No network, no storage -------------------------------------------------------------------------

	var nothing = function()
	{
		return Promise.resolve({ok: false, status: 404, text: function()
		{
			return Promise.resolve('');
		}});
	};
	var gone = function(target, name, value)
	{
		try
		{
			Object.defineProperty(target, name, {value: value, writable: false, configurable: false});
		}
		catch (e)
		{
			// Already gone.
		}
	};

	gone(window, 'fetch', nothing);
	gone(window, 'open', function()
	{
		return null;
	});
	['indexedDB', 'localStorage', 'sessionStorage', 'caches', 'cookieStore', 'openDatabase'].forEach(function(name)
	{
		gone(window, name, undefined);
	});
	gone(navigator, 'serviceWorker', undefined);

	try
	{
		Object.defineProperty(document, 'cookie', {get: function()
		{
			return '';
		}, set: function() {}, configurable: false});
	}
	catch (e)
	{
		// Already gone.
	}
})();
