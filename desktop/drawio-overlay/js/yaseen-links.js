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

	/**
	 * Every page listener of ours runs through this: draw.io turns an uncaught error into a native alert, which blocks
	 * the whole frame (the editor freezes). A fault of ours costs that one event, never the diagram.
	 */
	function listen(doc, type, handler, options)
	{
		doc.addEventListener(type, function(evt)
		{
			try
			{
				handler(evt);
			}
			catch (e)
			{
				console.error('Yaseen links', type, e);
			}
		}, (options != null) ? options : true);
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

		listen(doc, 'pointerdown', function(evt)
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
			listen(doc, type, function(evt)
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

		listen(doc, 'contextmenu', function(evt)
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

		listen(doc, 'mouseover', function(evt)
		{
			hover(pillOf(evt));
		}, true);

		listen(doc, 'mouseout', function(evt)
		{
			if (hovered != null && (evt.relatedTarget == null || !hovered.contains(evt.relatedTarget)))
			{
				hover(null);
			}
		}, true);

		// A pan or a zoom moves the pill from under its card.
		listen(doc, 'wheel', function()
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

		var making = installMaking(ui, post, replace);

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

			return making(msg);
		};
	}

	// ================================================================================
	// MAKING A PILL (2-): the label editor (D6), paste, the `[[` picker (D5), the sidebar drop (D4).
	// ================================================================================

	var WHOLE_LINK = /^\[\[[^\[\]]+\]\]$/;
	/** A paste the host may make a link of (the board's `pastedPath`): one line, a path or a `yaseendocs://` link. */
	var PATH_LIKE = /^\s*['"]?(\/|[A-Za-z]:[\\/]|yaseen(docs|draw):\/\/)/;

	function isPill(node)
	{
		return node != null && node.nodeType == 1 && /(^|\s)yaseen-pill(\s|$)/.test(node.className) && innerOf(node) != null;
	}

	/** In the label editor a pill is one unit (D6): the caret jumps it, Backspace or Delete takes it whole. */
	function fixPills(root)
	{
		var pills = root.querySelectorAll('.yaseen-pill');

		for (var i = 0; i < pills.length; i++)
		{
			pills[i].contentEditable = 'false';
		}
	}

	/**
	 * The label editor's text as the picker reads it (D5): each text node as it is, each pill as its raw `[[inner]]`, a
	 * line break and each new block as `\n`. `segments` places every part, so an offset maps back to the page.
	 */
	function modelOf(root)
	{
		var text = '';
		var segments = [];

		function add(node, kind, part)
		{
			segments.push({node: node, kind: kind, start: text.length, end: text.length + part.length});
			text += part;
		}

		(function walk(node)
		{
			for (var child = node.firstChild; child != null; child = child.nextSibling)
			{
				if (child.nodeType == 3)
				{
					add(child, 'text', child.data);
				}
				else if (isPill(child))
				{
					add(child, 'atom', '[[' + innerOf(child) + ']]');
				}
				else if (child.nodeName == 'BR')
				{
					add(child, 'atom', '\n');
				}
				else if (child.nodeType == 1)
				{
					if ((child.nodeName == 'DIV' || child.nodeName == 'P') && text.length > 0)
					{
						add(child, 'break', '\n');
					}

					walk(child);
				}
			}
		})(root);

		return {text: text, segments: segments};
	}

	/** Where the model's `offset` is on the page: inside a text node, or before / after an atom. */
	function placeOf(model, root, offset)
	{
		for (var i = 0; i < model.segments.length; i++)
		{
			var s = model.segments[i];

			if (offset > s.end || (offset == s.end && s.kind != 'text'))
			{
				continue;
			}

			if (s.kind == 'text')
			{
				return {node: s.node, offset: Math.max(0, offset - s.start)};
			}

			var parent = s.node.parentNode;
			var index = Array.prototype.indexOf.call(parent.childNodes, s.node);

			return {node: parent, offset: (offset <= s.start || s.kind == 'break') ? index : index + 1};
		}

		return {node: root, offset: root.childNodes.length};
	}

	function installMaking(ui, post, replaceInCell)
	{
		var graph = ui.editor.graph;
		var doc = document;

		// ---- D6: the label editor opens with the pills and saves `[[inner]]` again ----

		var setEditingValue = mxCellEditor.prototype.setEditingValue;

		mxCellEditor.prototype.setEditingValue = function(state)
		{
			setEditingValue.apply(this, arguments);

			try
			{
				if (this.textarea != null && this.textarea.innerHTML.indexOf('[[') >= 0 && this.graph.isHtmlLabel(state.cell))
				{
					this.textarea.innerHTML = withPills(this.textarea.innerHTML);
					fixPills(this.textarea);
				}
			}
			catch (e)
			{
				// The label opens as its raw text.
				console.error('Yaseen links', e);
			}
		};

		/**
		 * draw.io reads the label off the editor's HTML (and cleans it). Each pill is its raw text for that read, then
		 * goes back, so the editor keeps its pills and the caret.
		 */
		var getCurrentValue = mxCellEditor.prototype.getCurrentValue;

		mxCellEditor.prototype.getCurrentValue = function()
		{
			var pills = (this.textarea != null) ? this.textarea.querySelectorAll('.yaseen-pill') : [];
			var swapped = [];

			for (var i = 0; i < pills.length; i++)
			{
				var inner = innerOf(pills[i]);

				if (inner != null && pills[i].parentNode != null)
				{
					var raw = doc.createTextNode('[[' + inner + ']]');
					pills[i].parentNode.replaceChild(raw, pills[i]);
					swapped.push([raw, pills[i]]);
				}
			}

			try
			{
				return getCurrentValue.apply(this, arguments);
			}
			finally
			{
				for (var j = 0; j < swapped.length; j++)
				{
					if (swapped[j][0].parentNode != null)
					{
						swapped[j][0].parentNode.replaceChild(swapped[j][1], swapped[j][0]);
					}
				}
			}
		};

		function textarea()
		{
			return graph.isEditing() ? graph.cellEditor.textarea : null;
		}

		function selectionIn(root)
		{
			var selection = doc.getSelection();

			return (root != null && selection != null && selection.rangeCount > 0 &&
				root.contains(selection.getRangeAt(0).commonAncestorContainer)) ? selection : null;
		}

		/** A pill copied out of a label is its `[[inner]]` text, so it is a pill again in a note or a board. */
		function onCopy(evt)
		{
			var root = textarea();
			var selection = selectionIn(root);

			if (selection == null || evt.clipboardData == null)
			{
				return;
			}

			var holder = doc.createElement('div');
			holder.appendChild(selection.getRangeAt(0).cloneContents());
			var pills = holder.querySelectorAll('.yaseen-pill');

			if (pills.length == 0)
			{
				return;
			}

			for (var i = 0; i < pills.length; i++)
			{
				var inner = innerOf(pills[i]);
				pills[i].parentNode.replaceChild(doc.createTextNode((inner != null) ? '[[' + inner + ']]' : pills[i].textContent), pills[i]);
			}

			evt.preventDefault();
			evt.clipboardData.setData('text/plain', modelOf(holder).text);
			evt.clipboardData.setData('text/html', holder.innerHTML);

			if (evt.type == 'cut')
			{
				selection.deleteFromDocument();
			}
		}

		listen(doc, 'copy', onCopy, true);
		listen(doc, 'cut', onCopy, true);

		/** Text at the editor's selection: a whole `[[link]]` goes in as its pill. One edit the label editor can undo. */
		function insertAtSelection(root, text)
		{
			var html = WHOLE_LINK.test(text) ? withPills(escapeHtml(text)) : null;
			var done = typeof doc.execCommand == 'function' &&
				((html != null) ? doc.execCommand('insertHTML', false, html) : doc.execCommand('insertText', false, text));

			if (!done)
			{
				// No editing commands (a test page): put the nodes in by hand.
				var range = doc.getSelection().getRangeAt(0);
				range.deleteContents();
				var holder = doc.createElement('span');
				holder.innerHTML = (html != null) ? html : escapeHtml(text);
				var last = holder.lastChild;

				while (holder.firstChild != null)
				{
					range.insertNode(holder.lastChild);
				}

				if (last != null)
				{
					range.setStartAfter(last);
					range.collapse(true);
					doc.getSelection().removeAllRanges();
					doc.getSelection().addRange(range);
				}
			}

			fixPills(root);
		}

		function select(root, model, start, end)
		{
			var from = placeOf(model, root, start);
			var to = placeOf(model, root, end);
			var range = doc.createRange();
			range.setStart(from.node, from.offset);
			range.setEnd(to.node, to.offset);
			var selection = doc.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		}

		// ---- New text boxes on the canvas: a paste, a drop ----

		/** One text box for each link, stacked down from `pt` (graph units), selected, as ONE undo step. */
		function addLinkBoxes(links, pt)
		{
			var model = graph.getModel();
			var parent = graph.getDefaultParent();
			var cells = [];
			var y = pt.y;

			model.beginUpdate();

			try
			{
				for (var i = 0; i < links.length; i++)
				{
					var cell = graph.insertVertex(parent, null, escapeHtml(links[i]), pt.x, y, 120, 30,
						'text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;autosize=1;');
					graph.updateCellSize(cell, true);
					y += graph.getModel().getGeometry(cell).height + 10;
					cells.push(cell);
				}
			}
			finally
			{
				model.endUpdate();
			}

			graph.setSelectionCells(cells);

			return y;
		}

		/** A page point in graph units. */
		function graphPoint(clientX, clientY)
		{
			var pt = mxUtils.convertPoint(graph.container, clientX, clientY);
			var view = graph.view;

			return {x: Math.round(pt.x / view.scale - view.translate.x), y: Math.round(pt.y / view.scale - view.translate.y)};
		}

		// ---- Paste (2A) ----

		/** ⌘⇧V pastes text as it is (the board's rule): the next paste is not asked about. */
		var plainPaste = false;
		var pastes = {};
		var pasteCount = 0;

		listen(doc, 'paste', function(evt)
		{
			var plain = plainPaste;
			plainPaste = false;
			var text = (evt.clipboardData != null) ? evt.clipboardData.getData('text/plain') : '';
			var root = textarea();

			if (plain || !graph.isEnabled() || text.indexOf('\n') >= 0 || (root != null && !root.contains(evt.target)))
			{
				return;
			}

			var whole = WHOLE_LINK.test(text.trim());

			if (!whole && !PATH_LIKE.test(text))
			{
				return;
			}

			evt.preventDefault();
			evt.stopPropagation();

			if (whole && root != null)
			{
				insertAtSelection(root, text.trim());
				return;
			}

			var id = ++pasteCount;
			pastes[id] = (root != null) ?
				{cell: graph.cellEditor.getEditingCell(), range: doc.getSelection().getRangeAt(0).cloneRange(), text: text} :
				{cell: null, point: graph.getInsertPoint(), text: text};
			post({event: 'yaseenPaste', id: id, text: text});
		}, true);

		/** The host's word on a paste: the link, or null for the text as it is. */
		function pasteAnswer(id, link)
		{
			var paste = pastes[id];
			delete pastes[id];

			if (paste == null || !graph.isEnabled())
			{
				return;
			}

			var text = (link != null) ? link : paste.text;

			if (paste.cell == null)
			{
				addLinkBoxes([text], paste.point);
			}
			else if (graph.isEditing(paste.cell))
			{
				var selection = doc.getSelection();
				selection.removeAllRanges();
				selection.addRange(paste.range);
				insertAtSelection(graph.cellEditor.textarea, text);
			}
		}

		// ---- The `[[` picker (2A, D5) ----

		/** The host's picker is open: its keys come up to the host. */
		var pickerOpen = false;
		/** The host was told the editor's state, so it hears when that ends. */
		var told = false;

		function tell(typed)
		{
			var root = textarea();
			var selection = selectionIn(root);

			if (selection == null || (!told && root.textContent.indexOf('[[') < 0 && root.querySelector('.yaseen-pill') == null))
			{
				untell();
				return;
			}

			var model = modelOf(root);
			var before = doc.createRange();
			before.setStart(root, 0);
			before.setEnd(selection.focusNode, selection.focusOffset);
			var holder = doc.createElement('div');
			holder.appendChild(before.cloneContents());
			var caret = modelOf(holder).text.length;
			var head = model.text.substring(0, caret);

			// Only while `[[` is open before the caret does the host hear about it: typing stays here.
			if (head.lastIndexOf('[[') <= head.lastIndexOf(']]'))
			{
				untell();
				return;
			}

			var range = selection.getRangeAt(0);
			var rects = range.getClientRects();
			var r = (rects.length > 0) ? rects[rects.length - 1] : root.getBoundingClientRect();
			told = true;
			post({event: 'yaseenEditor', state: {text: model.text, caret: caret, typed: typed, cellId: graph.cellEditor.getEditingCell().id,
				rect: {left: r.left, top: r.top, right: r.right, bottom: r.bottom}}});
		}

		function untell()
		{
			if (told)
			{
				told = false;
				pickerOpen = false;
				post({event: 'yaseenEditor', state: null});
			}
		}

		listen(doc, 'input', function(evt)
		{
			var root = textarea();

			if (root != null && root.contains(evt.target))
			{
				fixPills(root);
				tell(true);
			}
		}, true);

		listen(doc, 'selectionchange', function()
		{
			if (told)
			{
				tell(false);
			}
		});

		var stopEditing = mxCellEditor.prototype.stopEditing;

		mxCellEditor.prototype.stopEditing = function()
		{
			try
			{
				return stopEditing.apply(this, arguments);
			}
			finally
			{
				untell();
			}
		};

		var PICKER_KEYS = {ArrowUp: true, ArrowDown: true, Enter: true, Escape: true};

		listen(doc, 'keydown', function(evt)
		{
			if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && (evt.key == 'v' || evt.key == 'V'))
			{
				plainPaste = true;
			}

			if (pickerOpen && PICKER_KEYS[evt.key] && !evt.isComposing && textarea() != null)
			{
				evt.preventDefault();
				evt.stopPropagation();
				post({event: 'yaseenEditorKey', key: evt.key});
			}
		}, true);

		/** The picker's pick: `text` from the model's `start` to `end`, where a whole `[[link]]` is its pill. */
		function editorReplace(start, end, text)
		{
			var root = textarea();

			if (root == null)
			{
				return;
			}

			root.focus();
			select(root, modelOf(root), start, end);
			insertAtSelection(root, text);
			tell(false);
		}

		/** A page the picker made gets its link (`[[ID]]`): in the open editor, or in the label once it closed. */
		function editorReplaceLink(cellId, raw, text)
		{
			var root = textarea();

			if (root != null && graph.cellEditor.getEditingCell().id == cellId)
			{
				var model = modelOf(root);
				var at = model.text.indexOf(raw);

				if (at >= 0)
				{
					select(root, model, at, at + raw.length);
					insertAtSelection(root, text);
				}
			}
			else if (WHOLE_LINK.test(raw))
			{
				replaceInCell(cellId, raw.substring(2, raw.length - 2), text);
			}
		}

		// ---- The sidebar drop (2B, D4) ----

		/** The app's sidebar drags pages now: a drop is the host's (it knows the paths). */
		var sidebarDrag = false;
		var drops = {};
		var dropCount = 0;

		function isPicture(file)
		{
			return /^image\//.test(file.type);
		}

		listen(doc, 'drop', function(evt)
		{
			var files = (evt.dataTransfer != null) ? Array.prototype.slice.call(evt.dataTransfer.files || []) : [];

			if (!sidebarDrag || graph.isEditing() || files.length == 0 || files.every(isPicture))
			{
				return;
			}

			evt.preventDefault();
			evt.stopPropagation();

			if (!graph.isEnabled())
			{
				return;
			}

			var id = ++dropCount;
			drops[id] = {point: graphPoint(evt.clientX, evt.clientY), pictures: files.filter(isPicture)};
			post({event: 'yaseenDrop', id: id});
		}, true);

		/** The host's links for a drop: one box each, then the pictures below the last box (the board's rule). */
		function dropAnswer(id, links)
		{
			var drop = drops[id];
			delete drops[id];

			if (drop == null || !graph.isEnabled())
			{
				return;
			}

			var below = (links.length > 0) ? addLinkBoxes(links, drop.point) : drop.point.y;

			if (drop.pictures.length > 0)
			{
				ui.importFiles(drop.pictures, drop.point.x, below);
			}
		}

		return function(msg)
		{
			switch (msg.action)
			{
				case 'yaseenPasteAnswer':
					pasteAnswer(msg.id, (typeof msg.link == 'string') ? msg.link : null);
					return true;
				case 'yaseenPickerOpen':
					pickerOpen = msg.open === true;
					return true;
				case 'yaseenEditorReplace':
					editorReplace(msg.start, msg.end, msg.text);
					return true;
				case 'yaseenEditorReplaceLink':
					editorReplaceLink(msg.cellId, msg.raw, msg.text);
					return true;
				case 'yaseenSidebarDrag':
					sidebarDrag = msg.on === true;
					return true;
				case 'yaseenDropLinks':
					dropAnswer(msg.id, Array.isArray(msg.links) ? msg.links : []);
					return true;
			}

			return false;
		};
	}

	window.yaseenLinks = {withPills: withPills, setLooks: setLooks, innerOf: innerOf, modelOf: modelOf, installEditor: installEditor};
})();
