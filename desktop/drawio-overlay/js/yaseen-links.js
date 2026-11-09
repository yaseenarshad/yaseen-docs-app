/**
 * Yaseen Docs' LINK PILLS in draw.io (YAZ-4748) — ours, laid beside draw.io's webapp by `tools/packDrawio.mjs`. The
 * editor loads it from our PostConfig.js (before the handshake, so before draw.io builds its one editor), and our
 * picture page loads it after draw.io's viewer (`yaseen-render.html`). Not draw.io code: it patches draw.io's public
 * prototypes, as PostConfig.js does.
 *
 * D1: a link is plain `[[inner]]` text in a label, as in a note and on a board, and the file keeps that text. In an
 * HTML label (draw.io's default for every new shape and text) it DRAWS as a pill: the page's file icon and its name.
 * D3: the host says what each pill shows (`setLooks`); the editor asks for the links it draws, once per batch.
 *
 * The editor's half (`installEditor`, D2): hover, the open gestures, the one link menu, and Edit link / Remove link.
 * Every rule lives in the host (`client/src/diagrams/drawioLinkBridge.ts`): this file reports where the pointer is
 * and does what the host answers.
 */
(function()
{
	var LINK = /\[\[([^\[\]]+)\]\]/g;

	/**
	 * What each link shows, as the host said: `{ label, missing?, folder?, icon? }`, or null for a link that stays raw
	 * text (`[[Note|]]`). `icon`: a data URL; null, no icon; absent, the icon is not drawn yet (an empty box holds its
	 * place). Emptied when it passes MAX_LOOKS: the host is asked again for what is on screen.
	 */
	var looks = {};
	var lookCount = 0;
	var MAX_LOOKS = 2000;

	/**
	 * Each link drawn so far gets a number, and its pill carries it as a class, `yaseen-link-<n>`: draw.io cleans a
	 * label's HTML after `getLabel` (DOMPurify with `ALLOW_DATA_ATTR` off), and a class is what it keeps. One entry per
	 * distinct link of this diagram; the page lives as long as its tab.
	 */
	var numbers = {};
	var links = [];

	function numberOf(inner)
	{
		if (!Object.prototype.hasOwnProperty.call(numbers, inner))
		{
			numbers[inner] = links.length;
			links.push(inner);
		}

		return numbers[inner];
	}

	/** The link a drawn pill stands for, or null. */
	function innerOf(pill)
	{
		var match = /(?:^|\s)yaseen-link-(\d+)(?:\s|$)/.exec(pill.className);

		return (match != null && links[match[1]] != null) ? links[match[1]] : null;
	}

	/** The editor's ask for looks (`installEditor`); null on the picture page, whose request carries every look. */
	var ask = null;
	/** Links asked for and not answered yet, so a redraw does not ask twice; and the batch to send. */
	var requested = {};
	var batch = null;

	function escapeHtml(text)
	{
		return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	/** An HTML label's text as written: `[[Q&amp;A]]` is the link `Q&A`. */
	function decodeHtml(html)
	{
		return html.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
			.replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
	}

	/** Until the host answers, a link reads as found, by its written name (the board's rule): the alias, else the link. */
	function writtenLook(inner)
	{
		var bar = inner.indexOf('|');

		return {label: (bar >= 0) ? inner.substring(bar + 1) : inner};
	}

	function lookOf(inner)
	{
		if (Object.prototype.hasOwnProperty.call(looks, inner))
		{
			return looks[inner];
		}

		if (ask == null)
		{
			return null;
		}

		if (!requested[inner])
		{
			requested[inner] = true;

			if (batch == null)
			{
				batch = [];
				window.setTimeout(function()
				{
					var inners = batch;
					batch = null;
					ask(inners);
				}, 0);
			}

			batch.push(inner);
		}

		return writtenLook(inner);
	}

	/** One pill: an atom of the label, as on a board. Its link is its number's class (`numberOf`). */
	function pillHtml(inner, look)
	{
		var icon = (look.missing || look.icon === null) ? '' : (typeof look.icon == 'string') ?
			'<img class="yaseen-pill__icon" src="' + escapeHtml(look.icon) + '">' : '<span class="yaseen-pill__icon"></span>';

		return '<span class="yaseen-pill yaseen-link-' + numberOf(inner) + (look.missing ? ' yaseen-pill--missing' : '') + '">' +
			icon + escapeHtml(look.label) + '</span>';
	}

	/** An HTML label with each `[[inner]]` drawn as its pill; a link with no look stays raw text. */
	function withPills(html)
	{
		return html.replace(LINK, function(raw, written)
		{
			var inner = decodeHtml(written);
			var look = lookOf(inner);

			return (look == null) ? raw : pillHtml(inner, look);
		});
	}

	/** The host's looks: merged in, and a link it answered is no longer asked for. */
	function setLooks(next)
	{
		for (var inner in next)
		{
			if (!Object.prototype.hasOwnProperty.call(looks, inner))
			{
				lookCount++;
			}

			looks[inner] = next[inner];
			delete requested[inner];
		}

		if (lookCount > MAX_LOOKS)
		{
			looks = {};
			lookCount = 0;
		}
	}

	// D1: every place draw.io draws a label asks `getLabel` (the canvas, the size of an autosized cell, the SVG export).
	// A plain-text label (`html=0`) has no markup to hold a pill: it shows the raw text.
	var getLabel = Graph.prototype.getLabel;

	Graph.prototype.getLabel = function(cell)
	{
		var label = getLabel.apply(this, arguments);

		return (typeof label == 'string' && label.indexOf('[[') >= 0 && this.isHtmlLabel(cell)) ? withPills(label) : label;
	};

	// The board pill's look (the engine's `getLinkPillMetrics` / `getLinkPillColors`), in em of the label's font.
	// `light-dark` follows draw.io's own dark mode, which sets `color-scheme` on the page.
	if (typeof document != 'undefined' && document.head != null)
	{
		var style = document.createElement('style');
		// An inline block keeps the pill's name on the line's baseline, beside the label's own text.
		style.textContent = '.yaseen-pill{display:inline-block;padding:0 0.25em;border-radius:0.25em;white-space:nowrap;' +
			'line-height:1.25em;color:light-dark(#5b6cff,#7c8aff);background:light-dark(#5b6cff1a,#7c8aff26)}' +
			'.yaseen-pill--missing{color:light-dark(#7a7a7a,#8f8f8f);background:none}' +
			'.yaseen-pill__icon{display:inline-block;width:0.75em;height:0.75em;margin-right:0.2em;vertical-align:-0.08em;object-fit:contain}' +
			'span.yaseen-pill__icon{box-sizing:border-box;border:1px solid currentColor;border-radius:0.1em;opacity:0.4}';
		document.head.appendChild(style);
	}

	/** The held modifiers as one key of the host's open table (`yaseenLinkOpens`): ⌘, ⌃, ⌥, ⇧. */
	function modsKey(evt)
	{
		return (evt.metaKey ? 'M' : '') + (evt.ctrlKey ? 'C' : '') + (evt.altKey ? 'A' : '') + (evt.shiftKey ? 'S' : '');
	}

	function modsOf(evt)
	{
		return {metaKey: evt.metaKey === true, ctrlKey: evt.ctrlKey === true, altKey: evt.altKey === true, shiftKey: evt.shiftKey === true};
	}

	function rectOf(element)
	{
		var r = element.getBoundingClientRect();

		return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
	}

	/**
	 * The editor's half (D2). `post` sends a message to the host. The pointer events are read in the CAPTURE phase on
	 * the page, before draw.io's own handlers on its container: a gesture the host takes never also selects, drags or
	 * opens draw.io's menu.
	 */
	function installEditor(ui, post)
	{
		var graph = ui.editor.graph;
		// The page itself: draw.io gives the graph its container only after `createUi`, where this runs.
		var doc = document;
		/** The modifier keys that open a link now (the host's table, the gestures and the read-only switch). */
		var opens = {};
		/** The pill the pointer rests on. */
		var hovered = null;
		/** A press the host took: its up, click and the mouse events after it stay away from draw.io. */
		var swallowing = false;

		ask = function(inners)
		{
			post({event: 'yaseenLinkLooks', inners: inners});
		};

		/** The drawn pill under the event, or null; a pill inside the open label editor is the editor's (D6). */
		function pillOf(evt)
		{
			var target = evt.target;
			var pill = (target != null && typeof target.closest == 'function') ? target.closest('.yaseen-pill') : null;
			var editing = graph.cellEditor.textarea;

			return (pill == null || innerOf(pill) == null || (editing != null && editing.contains(pill))) ? null : pill;
		}

		function cellIdAt(evt)
		{
			var pt = mxUtils.convertPoint(graph.container, evt.clientX, evt.clientY);
			var cell = graph.getCellAt(pt.x, pt.y);

			return (cell != null) ? cell.id : null;
		}

		function hover(pill)
		{
			if (pill === hovered)
			{
				return;
			}

			hovered = pill;
			post({event: 'yaseenLinkHover', inner: (pill != null) ? innerOf(pill) : null,
				rect: (pill != null) ? rectOf(pill) : null});
		}

		function stop(evt)
		{
			evt.preventDefault();
			evt.stopPropagation();
		}

		/** A right-click, or a ⌃-click on a Mac (draw.io's own popup trigger), unless ⌃-click is an open gesture. */
		function isMenuPress(evt)
		{
			return evt.button == 2 || (evt.button == 0 && evt.ctrlKey && mxClient.IS_MAC && !opens[modsKey(evt)]);
		}

		doc.addEventListener('pointerdown', function(evt)
		{
			var pill = pillOf(evt);
			swallowing = false;
			hover(null);

			if (pill == null)
			{
				return;
			}

			if (isMenuPress(evt))
			{
				swallowing = true;
				stop(evt);
			}
			else if (evt.button == 0 && opens[modsKey(evt)])
			{
				swallowing = true;
				stop(evt);
				post({event: 'yaseenLinkClick', inner: innerOf(pill), cellId: cellIdAt(evt), mods: modsOf(evt)});
			}
		}, true);

		['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach(function(type)
		{
			doc.addEventListener(type, function(evt)
			{
				if (swallowing)
				{
					stop(evt);
				}

				if (type == 'click')
				{
					swallowing = false;
				}
			}, true);
		});

		doc.addEventListener('contextmenu', function(evt)
		{
			var pill = pillOf(evt);

			if (pill == null)
			{
				return;
			}

			stop(evt);
			swallowing = false;
			post({event: 'yaseenLinkMenu', inner: innerOf(pill), cellId: cellIdAt(evt), x: evt.clientX, y: evt.clientY});
		}, true);

		doc.addEventListener('mouseover', function(evt)
		{
			hover(pillOf(evt));
		}, true);

		doc.addEventListener('mouseout', function(evt)
		{
			if (hovered != null && (evt.relatedTarget == null || !hovered.contains(evt.relatedTarget)))
			{
				hover(null);
			}
		}, true);

		// A pan or a zoom moves the pill from under its card.
		doc.addEventListener('wheel', function()
		{
			hover(null);
		}, {capture: true, passive: true});

		/**
		 * Edit link and Remove link (D15 of the board): `text` in place of the first raw `[[inner]]` of the cell's label,
		 * as ONE undo step (draw.io's own `labelChanged`). Nothing on a read-only diagram, whose graph is off.
		 */
		function replace(cellId, inner, text)
		{
			var cell = graph.getModel().getCell(cellId);

			if (cell == null || !graph.isEnabled())
			{
				return;
			}

			var html = graph.isHtmlLabel(cell);
			var label = graph.convertValueToString(cell);
			var raw = '[[' + (html ? escapeHtml(inner) : inner) + ']]';
			var at = label.indexOf(raw);

			if (at < 0 && html)
			{
				raw = '[[' + inner + ']]';
				at = label.indexOf(raw);
			}

			if (at >= 0)
			{
				graph.labelChanged(cell, label.substring(0, at) + (html ? escapeHtml(text) : text) + label.substring(at + raw.length));
			}
		}

		return function(msg)
		{
			switch (msg.action)
			{
				case 'yaseenLinkLooks':
					setLooks(msg.looks || {});
					graph.refresh();
					return true;
				case 'yaseenLinkOpens':
					opens = {};
					(msg.opens || []).forEach(function(key)
					{
						opens[key] = true;
					});
					return true;
				case 'yaseenLinkReplace':
					replace(msg.cellId, msg.inner, msg.text);
					return true;
			}

			return false;
		};
	}

	window.yaseenLinks = {withPills: withPills, setLooks: setLooks, innerOf: innerOf, installEditor: installEditor};
})();
