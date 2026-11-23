/**
 * Yaseen Docs' PostConfig (Draw's 🔒 YAZ-1802 D12a / D12b / D16, ported by YAZ-3028) — laid over draw.io's own stub by `tools/packDrawio.mjs`.
 * draw.io's `bootstrap.js` loads this right AFTER `app.min.js` whenever the page is not on a
 * draw.io domain. It is a config hook, not draw.io code: the first block is draw.io's stub
 * verbatim, everything below it is ours and only patches draw.io's public prototypes.
 *
 * ORDER IS GUARANTEED BY THE HOST, not by luck. The editor is built only after the host answers
 * draw.io's `configure` event (configure=1), and `DrawioEditor` answers it only once this file
 * has posted `{ event: 'yaseenReady' }` — so every prototype below is patched before the one
 * `EditorUi` exists. `tools/drawioOverlay.test.mjs` runs this file against a stand-in draw.io.
 *
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

// ---- Yaseen Docs ----
(function()
{
	// 🔒 YAZ-1802 D12a: plain wheel pans (draw.io's default with zoomWheel off), ctrl+wheel and a
	// trackpad pinch (Chromium sends it as ctrl+wheel) zoom — and so does ⌘+wheel, Excalidraw's gesture.
	var isZoomWheelEvent = Graph.prototype.isZoomWheelEvent;

	Graph.prototype.isZoomWheelEvent = function(evt)
	{
		return mxEvent.isMetaDown(evt) || isZoomWheelEvent.apply(this, arguments);
	};

	// 🔒 YAZ-1802 D12a: every diagram opens with the shapes panel COLLAPSED — the canvas gets the
	// room, and the toolbar's shapes button reopens the panel at draw.io's default width. Without
	// this, draw.io restores the last width it saved (`mxSettings`) or its own open default.
	mxSettings.getSidebarWidth = function()
	{
		return null;
	};

	// YAZ-3420 D1: the Format panel and the Layers, Outline and Tags windows also open CLOSED,
	// every time. draw.io saves each one in `mxSettings` (one store for every tab), opens Layers
	// on a diagram with more than one layer, and opens Shapes and Format when the frame grows past
	// 864 / 1024 px. The toolbar and the View menu still open them.
	mxSettings.getFormatWidth = function()
	{
		return 0;
	};

	EditorUi.prototype.restoreVisibleWindows = function() {};
	EditorUi.prototype.showLayersDialog = function() {};

	var windowResized = EditorUi.prototype.windowResized;

	EditorUi.prototype.windowResized = function()
	{
		// draw.io toggles a panel only when it knows the last width; without it, a resize only lays out.
		this.lastWindowWidth = null;
		windowResized.apply(this, arguments);
	};

	/** The one editor this page builds (embed mode has one), for the host's live messages below. */
	var editorUi = null;
	/** YAZ-4748: the link pills' answer to the host's messages (`yaseen-links.js`), once the editor exists. */
	var linkMessage = null;
	var createUi = EditorUi.prototype.createUi;

	EditorUi.prototype.createUi = function()
	{
		editorUi = this;
		this.hsplitPosition = 0;
		createUi.apply(this, arguments);
		installTextScaling(this.editor.graph);

		if (window.yaseenLinks != null)
		{
			linkMessage = window.yaseenLinks.installEditor(this, postToHost);
		}
	};

	// YAZ-3719 D1: a CLOSED shapes panel has nothing to grab. draw.io keeps its drag strip (`geHsplit`,
	// 10 px) at the panel's right edge, so at 0 px it lies at the frame's left edge, right beside the
	// app's sidebar edge: without this, a press meant for the sidebar opens the panel. Every open and
	// close sets `hsplitPosition`, then calls `refresh`. `visibility`, because `setGraphEnabled` owns `display`.
	var refresh = EditorUi.prototype.refresh;

	EditorUi.prototype.refresh = function()
	{
		refresh.apply(this, arguments);
		this.hsplit.style.visibility = (this.hsplitPosition > 0) ? '' : 'hidden';
	};

	// YAZ-3420 D2: a load the host flags with `yaseenKeepView` (an outside change on a clean tab)
	// keeps the page and the view. draw.io's embed load is `setFileData` (the first page, its
	// scrollbars reset) then `fitInitialView`; the view comes back in place of that last fit. It
	// runs inside the load, while draw.io ignores changes, so nothing autosaves. draw.io also fits
	// a page it shows for the first time, INSIDE `setFileData` and `selectPage`: those stay its own.
	var keptView = null;
	var settingFileData = false;
	var setFileData = EditorUi.prototype.setFileData;
	var fitInitialView = EditorUi.prototype.fitInitialView;

	EditorUi.prototype.setFileData = function()
	{
		settingFileData = true;

		try
		{
			return setFileData.apply(this, arguments);
		}
		catch (e)
		{
			// A file draw.io cannot read ends the load here, before its last fit: the view is not kept for later.
			keptView = null;
			throw e;
		}
		finally
		{
			settingFileData = false;
		}
	};

	EditorUi.prototype.fitInitialView = function()
	{
		if (settingFileData)
		{
			return fitInitialView.apply(this, arguments);
		}

		var kept = keptView;
		keptView = null;
		var page = (kept != null) ? (this.getPageById(kept.pageId) || this.pages[kept.pageIndex]) : null;

		if (page == null)
		{
			return fitInitialView.apply(this, arguments);
		}

		this.selectPage(page, true);
		this.editor.graph.view.setScale(kept.scale);
		this.restoreScrollState(kept.scroll);
	};

	/** What D2 keeps: the page (by id, then by place), the zoom, and draw.io's own scroll state. */
	function currentView(ui)
	{
		return (ui == null || ui.currentPage == null) ? null : {
			pageId: ui.currentPage.getId(),
			pageIndex: mxUtils.indexOf(ui.pages, ui.currentPage),
			scale: ui.editor.graph.view.scale,
			scroll: ui.saveScrollState()
		};
	}

	// YAZ-3076 D2: the file says read only, so the graph takes no edits — the host's `yaseenReadOnly`
	// message, sent only after draw.io's `init` (when the editor exists, as for `yaseenAdaptiveColors`)
	// and on every change. draw.io's own viewer does the same (`graph.isEnabled` false): selection,
	// moves, the rubber band, the keys and a drop from the shapes panel all ask `graph.isEnabled()`,
	// while the wheel and the panning handler do not, so pan and zoom still work. Two things draw.io
	// leaves on are closed here: a label being typed is CANCELLED, never applied (`stopEditing(cancel)`,
	// YAZ-3116 A2), and the selection is cleared (no Format panel edits a cell picked before); and the
	// toolbar's Undo / Redo, which follow only the undo history, are off while the graph is.
	function applyReadOnly(readOnly)
	{
		var graph = editorUi.editor.graph;

		if (readOnly)
		{
			// Only while a label IS being typed (YAZ-3119), and with draw.io's focus pull silenced (YAZ-3123):
			// draw.io's wrap of `stopEditing` ends with `cellEditor.focusContainer()`, which focuses the
			// diagram container. A click on the cog moves the focus to the host while draw.io keeps the
			// label open, so that pull would take the keyboard back into this frame and the cog's menu
			// would close. The cell editor's own `focusContainer` (EditorUi sets one on the instance) is
			// shadowed for the call and put back after.
			if (graph.isEditing())
			{
				var cellEditor = graph.cellEditor;
				var ownPull = Object.prototype.hasOwnProperty.call(cellEditor, 'focusContainer');
				var pull = cellEditor.focusContainer;
				cellEditor.focusContainer = function() {};

				try
				{
					graph.stopEditing(true);
				}
				finally
				{
					if (ownPull)
					{
						cellEditor.focusContainer = pull;
					}
					else
					{
						delete cellEditor.focusContainer;
					}
				}
			}

			graph.clearSelection();
		}

		graph.setEnabled(!readOnly);

		if (editorUi.actions != null)
		{
			editorUi.updateActionStates();
		}
	}

	var updateActionStates = EditorUi.prototype.updateActionStates;

	EditorUi.prototype.updateActionStates = function()
	{
		updateActionStates.apply(this, arguments);

		if (!this.editor.graph.isEnabled())
		{
			this.actions.get('undo').setEnabled(false);
			this.actions.get('redo').setEnabled(false);
		}
	};

	// 🔒 YAZ-1802 D16: the app's "draw.io diagrams in dark mode" setting, LIVE. draw.io reads it once,
	// as the configure reply's `defaultAdaptiveColors`, and has no embed action to change it, so the
	// host's `yaseenAdaptiveColors` message is answered here — only after draw.io's `init`, when the
	// editor exists. It moves draw.io's DEFAULT (a file's own `adaptiveColors` still wins) and
	// re-draws what `EditorUi.setAdaptiveColors` re-draws, minus the file edit draw.io's own menu
	// makes of it: nothing is marked modified, nothing autosaves, undo is untouched. Added before
	// draw.io's embed handler exists (the handshake), so it can keep draw.io from answering an
	// action it does not know with `unknownMessage`.
	var keepHostFocus = false;
	var focusWindow = window.focus;

	window.focus = function()
	{
		if (!keepHostFocus)
		{
			focusWindow.apply(window, arguments);
		}
	};

	window.addEventListener('message', function(evt)
	{
		var msg = null;

		try
		{
			msg = (evt.source === window.parent) ? JSON.parse(evt.data) : null;
		}
		catch (e)
		{
			return;
		}

		// YAZ-3084: a tab's name field opened by a double-click keeps the caret. draw.io calls
		// `window.focus()` as it handles a `load`, which would take the caret into this frame; the host
		// flags that one load, and the flag ends once draw.io's own handler has run.
		if (msg != null && msg.action == 'load')
		{
			// YAZ-4279 D5: a new document on screen; no outline is about it.
			clearMarks(null);
			keepHostFocus = msg.yaseenKeepFocus === true;
			keptView = (msg.yaseenKeepView === true) ? currentView(editorUi) : null;
			window.setTimeout(function()
			{
				keepHostFocus = false;
			}, 0);
		}

		if (msg != null && msg.action == 'yaseenReadOnly')
		{
			evt.stopImmediatePropagation();
			applyReadOnly(msg.value === true);
		}

		// YAZ-4748: the link pills' messages (`yaseen-links.js`), only once the editor exists, like the ones above. A
		// fault there is logged: draw.io would show an uncaught error as an alert, which blocks the editor.
		try
		{
			if (msg != null && linkMessage != null && linkMessage(msg))
			{
				evt.stopImmediatePropagation();
			}
		}
		catch (e)
		{
			evt.stopImmediatePropagation();
			console.error('Yaseen links', msg.action, e);
		}

		if (msg != null && msg.action == 'yaseenAdaptiveColors')
		{
			evt.stopImmediatePropagation();
			Graph.defaultAdaptiveColors = msg.value;
			var graph = editorUi.editor.graph;
			editorUi.setAdaptiveColors((graph.adaptiveColors != null) ? graph.adaptiveColors : 'default');
			graph.refresh();
		}

		// YAZ-4279 D2: an outside save of this diagram, merged by draw.io's own merge (the one its cloud files use). Not
		// draw.io's embed `merge`: it diffs against the last `load`, and the host's saves since never moved that, so
		// they would read as the other side's edits. Ours diffs against the HOST's base.
		// Only the LATEST request runs once the gesture ends (4A-2), and one the host gave up on never runs.
		if (msg != null && msg.action == 'yaseenMerge')
		{
			evt.stopImmediatePropagation();
			mergeWanted = msg;

			if (!mergeWaiting)
			{
				mergeWaiting = true;
				whenIdle(function()
				{
					var wanted = mergeWanted;
					mergeWaiting = false;
					mergeWanted = null;

					if (wanted != null)
					{
						mergeOutside(wanted);
					}
				});
			}
		}

		if (msg != null && msg.action == 'yaseenMergeCancel')
		{
			evt.stopImmediatePropagation();

			if (mergeWanted != null && mergeWanted.id == msg.id)
			{
				mergeWanted = null;
			}
		}

		// YAZ-4279 item 8: Keep mine answered the bar, so the red outlines of the clash go.
		if (msg != null && msg.action == 'yaseenClearClash')
		{
			evt.stopImmediatePropagation();
			clearMarks('clash');
		}

		// YAZ-6416: OutsideUpdateChip parity for draw.io (Show, 1/N cycling, Back, Mark checked).
		if (msg != null && msg.action == 'yaseenShowCells')
		{
			evt.stopImmediatePropagation();
			showCells(Array.isArray(msg.ids) ? msg.ids : []);
		}

		if (msg != null && msg.action == 'yaseenRestoreView')
		{
			evt.stopImmediatePropagation();
			restoreBackView();
		}

		if (msg != null && msg.action == 'yaseenClearOutsideMarks')
		{
			evt.stopImmediatePropagation();
			savedBackView = null;
			clearMarks('outside');
		}
	});

	/** The one `yaseenMerge` waiting for the gesture to end, and whether a wait runs. */
	var mergeWanted = null;
	var mergeWaiting = false;

	/** YAZ-4279 item 2: a label being typed, or a drag, ends first; a merge under it would end it for the user. */
	function whenIdle(then)
	{
		var graph = editorUi.editor.graph;

		if (!graph.isEditing() && !graph.isMouseDown)
		{
			then();
		}
		else
		{
			window.setTimeout(function()
			{
				whenIdle(then);
			}, 150);
		}
	}

	/**
	 * The merge (D2, D4). A field both sides changed, or a cell one side removed and the other changed, is the user's
	 * to settle: the answer is a conflict, and nothing changes. draw.io alone would keep ours in silence
	 * (`DrawioFile.LAST_WRITE_WINS`). Undo, the selection and the view stay. Just before the merge, `yaseenMerging` tells
	 * the host that every edit of the user's is in (4A-1: a label typed while it waited came first). draw.io's own
	 * `autosave` then posts the page on screen; the answer carries the whole merged file, because a change to another page
	 * posts no `autosave` (4A-3).
	 */
	function mergeOutside(msg)
	{
		var answer = function(extra)
		{
			extra.event = 'yaseenMerge';
			extra.id = msg.id;
			postToHost(extra);
		};

		try
		{
			var file = editorUi.getCurrentFile();

			if (file == null)
			{
				answer({conflict: true});

				return;
			}

			var base = editorUi.getPagesForXml(msg.base);
			var theirs = editorUi.diffPages(base, editorUi.getPagesForXml(msg.xml));
			var clash = clashes(editorUi.diffPages(base, editorUi.pages), theirs);

			clearMarks('clash');

			if (clash != null)
			{
				markCells(clash, 'clash', null);
				answer({conflict: true});

				return;
			}

			postToHost({event: 'yaseenMerging', id: msg.id});
			file.setShadowPages(base);
			file.mergeFile(new LocalFile(editorUi, msg.xml), function()
			{
				var changed = changedCells(theirs);
				clearMarks('outside');
				savedBackView = null;
				markCells(changed.added, 'added', msg.glow);
				markCells(changed.changed, 'changed', msg.glow);
				var allIds = changed.added.concat(changed.changed);
				var graph = editorUi.editor.graph;
				answer({
					xml: embedXml(),
					changedIds: allIds,
					groups: clusterCellIds(graph, allIds),
					offscreen: areCellsOffscreen(graph, allIds)
				});
			}, function()
			{
				answer({conflict: true});
			});
		}
		catch (e)
		{
			console.error('yaseenMerge', e);
			answer({conflict: true});
		}
	}

	/** The file as the embed's own `autosave` posts it (its `y()`): every page, or the one graph of a one-page file. */
	function embedXml()
	{
		return ('0' != urlParams['pages'] || (editorUi.pages != null && editorUi.pages.length > 1)) ? editorUi.getFileData(true) : mxUtils.getXml(editorUi.editor.getGraphXml());
	}

	/**
	 * Two of draw.io's diffs (`EditorUi.diffPages`) touch one thing: a page or cell removed on one side and changed on the
	 * other, a cell added into a parent or onto an end the other side removed, one field changed on both (a label is one
	 * field, `value` or `xmlValue`), or a page renamed or re-boxed on both (4A-9). Null: no clash; otherwise the cells
	 * that clash (item 8), none for a page.
	 */
	function clashes(mine, theirs)
	{
		var mu = mine.u || {}, tu = theirs.u || {}, ids = [], clash = false;

		if (removedChanged(mine.r, tu).length > 0 || removedChanged(theirs.r, mu).length > 0)
		{
			clash = true;
		}

		for (var id in tu)
		{
			var m = mu[id], t = tu[id];

			if (m == null)
			{
				continue;
			}

			if (differs(t.name, m.name) || differs(t.viewBox, m.viewBox) || bothChanged(t.view, m.view))
			{
				clash = true;
			}

			var tc = t.cells || {}, mc = m.cells || {}, tcu = tc.u || {}, mcu = mc.u || {};
			ids = ids.concat(removedChanged(tc.r, mcu), removedChanged(mc.r, tcu), addedOnto(tc.i, mc.r), addedOnto(mc.i, tc.r));

			for (var cell in tcu)
			{
				if (bothChanged(tcu[cell], mcu[cell]))
				{
					ids.push(cell);
				}
			}

			// One cell id added on both sides, with two contents.
			var added = {};
			(mc.i || []).forEach(function(c) { added[c.id] = JSON.stringify(c); });
			(tc.i || []).forEach(function(c)
			{
				if (added[c.id] != null && added[c.id] != JSON.stringify(c))
				{
					ids.push(c.id);
				}
			});
		}

		return (clash || ids.length > 0) ? ids : null;
	}

	function differs(a, b)
	{
		return a != null && b != null && a != b;
	}

	/** The cells one side added into a parent, or onto a source or target, that the other side removed. */
	function addedOnto(inserted, removed)
	{
		var gone = {};
		(removed || []).forEach(function(id) { gone[id] = true; });

		return (inserted || []).filter(function(c) { return gone[c.parent] || gone[c.source] || gone[c.target]; }).map(function(c) { return c.id; });
	}

	/** The ids removed on one side that the other side changed. */
	function removedChanged(removed, changed)
	{
		return (removed || []).filter(function(id) { return changed[id] != null; });
	}

	function bothChanged(a, b)
	{
		if (a == null || b == null)
		{
			return false;
		}

		a = oneLabel(a);
		b = oneLabel(b);

		for (var key in a)
		{
			if (key in b && JSON.stringify(a[key]) != JSON.stringify(b[key]))
			{
				return true;
			}
		}

		return false;
	}

	/** draw.io keeps a label as `xmlValue` once its cell has attributes: one field, whatever its name. */
	function oneLabel(fields)
	{
		if (!('xmlValue' in fields))
		{
			return fields;
		}

		var out = {};

		for (var key in fields)
		{
			out[(key == 'xmlValue') ? 'value' : key] = fields[key];
		}

		return out;
	}

	/**
	 * YAZ-4279 D5, items 7 and 8: the outlines on the page on screen — green for a cell the outside save added, amber for one
	 * it changed (Version history's colours), red for a clash while the bar shows. draw.io's own highlight, so they follow
	 * the zoom and scroll; never in the model, so never in the file or undo. The Glow setting times the green and amber:
	 * "Until I check it" — until that cell is selected or changed — 10 s, 1 min, or not at all.
	 */
	var MARK_COLORS = {added: '#2f9e44', changed: '#f08c00', clash: '#e03131'};
	var marks = [];
	var marksWatched = false;
	var savedBackView = null;

	function cellRect(graph, id)
	{
		var cell = graph.model.getCell(id);
		var state = (cell != null) ? graph.view.getState(cell) : null;

		if (state == null)
		{
			return null;
		}

		return {id: id, x: state.x, y: state.y, width: state.width, height: state.height};
	}

	function clusterCellIds(graph, ids)
	{
		var rects = [];

		for (var i = 0; i < ids.length; i++)
		{
			var r = cellRect(graph, ids[i]);

			if (r != null)
			{
				rects.push(r);
			}
		}

		if (rects.length <= 1)
		{
			return rects.length == 1 ? [[rects[0].id]] : [];
		}

		var pad = 300 * (graph.view.scale || 1);
		var visited = {};
		var clusters = [];

		for (var a = 0; a < rects.length; a++)
		{
			if (visited[a])
			{
				continue;
			}

			visited[a] = true;
			var queue = [a];
			var groupIds = [];
			var minX = Infinity, minY = Infinity;

			while (queue.length > 0)
			{
				var cur = queue.pop();
				var el = rects[cur];
				groupIds.push(el.id);

				if (el.x < minX) minX = el.x;
				if (el.y < minY) minY = el.y;

				for (var b = 0; b < rects.length; b++)
				{
					if (!visited[b])
					{
						var other = rects[b];

						if (el.x - pad <= other.x + other.width &&
							other.x - pad <= el.x + el.width &&
							el.y - pad <= other.y + other.height &&
							other.y - pad <= el.y + el.height)
						{
							visited[b] = true;
							queue.push(b);
						}
					}
				}
			}

			clusters.push({ids: groupIds, minX: minX, minY: minY});
		}

		clusters.sort(function(x, y)
		{
			return Math.round(x.minY / 200) - Math.round(y.minY / 200) || x.minX - y.minX;
		});

		return clusters.map(function(c) { return c.ids; });
	}

	function areCellsOffscreen(graph, ids)
	{
		var container = graph.container;

		if (container == null || ids.length == 0)
		{
			return false;
		}

		var vx1 = container.scrollLeft;
		var vy1 = container.scrollTop;
		var vx2 = vx1 + container.clientWidth;
		var vy2 = vy1 + container.clientHeight;
		var pad = 24;

		for (var i = 0; i < ids.length; i++)
		{
			var r = cellRect(graph, ids[i]);

			if (r != null && (r.x < vx1 + pad || r.y < vy1 + pad || r.x + r.width > vx2 - pad || r.y + r.height > vy2 - pad))
			{
				return true;
			}
		}

		return false;
	}

	function showCells(ids)
	{
		var graph = editorUi.editor.graph;
		var container = graph.container;

		if (container == null || ids.length == 0)
		{
			return;
		}

		if (savedBackView == null)
		{
			savedBackView = currentView(editorUi);
		}

		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;

		for (var i = 0; i < ids.length; i++)
		{
			var r = cellRect(graph, ids[i]);

			if (r != null)
			{
				found = true;
				if (r.x < minX) minX = r.x;
				if (r.y < minY) minY = r.y;
				if (r.x + r.width > maxX) maxX = r.x + r.width;
				if (r.y + r.height > maxY) maxY = r.y + r.height;
			}
		}

		if (!found)
		{
			return;
		}

		var cx = (minX + maxX) / 2;
		var cy = (minY + maxY) / 2;
		container.scrollLeft = Math.max(0, Math.round(cx - container.clientWidth / 2));
		container.scrollTop = Math.max(0, Math.round(cy - container.clientHeight / 2));
	}

	function restoreBackView()
	{
		if (savedBackView == null)
		{
			return;
		}

		var view = savedBackView;
		savedBackView = null;
		var page = editorUi.getPageById(view.pageId) || editorUi.pages[view.pageIndex];

		if (page != null && page != editorUi.currentPage)
		{
			editorUi.selectPage(page, true);
		}

		editorUi.editor.graph.view.setScale(view.scale);
		editorUi.restoreScrollState(view.scroll);
	}

	function markCells(ids, kind, glow)
	{
		var graph = editorUi.editor.graph;

		if (glow == 'off' || ids.length == 0)
		{
			return;
		}

		watchMarks(graph);

		for (var i = 0; i < ids.length; i++)
		{
			var cell = graph.model.getCell(ids[i]);
			var state = (cell != null) ? graph.view.getState(cell) : null;

			if (state != null)
			{
				var highlight = new mxCellHighlight(graph, MARK_COLORS[kind], 3, false);
				highlight.highlight(state);
				marks.push({id: ids[i], kind: kind, glow: glow, highlight: highlight});
			}
		}

		var ms = (glow == '60s') ? 60000 : ((glow == '5m') ? 300000 : ((glow == '10s') ? 10000 : null));

		if (ms != null)
		{
			var timed = marks.filter(function(mark) { return mark.kind == kind; });

			window.setTimeout(function()
			{
				dropMarks(function(mark) { return timed.indexOf(mark) >= 0; });
			}, ms);
		}
	}

	/** `which`: 'clash', 'outside' (green and amber), or null for all. */
	function clearMarks(which)
	{
		dropMarks(function(mark)
		{
			return which == null || (which == 'clash') == (mark.kind == 'clash');
		});
	}

	function dropMarks(match)
	{
		marks = marks.filter(function(mark)
		{
			if (!match(mark))
			{
				return true;
			}

			mark.highlight.destroy();

			return false;
		});
	}

	/** "Until I check it": a marked cell the user selects, or changes, is checked. */
	function watchMarks(graph)
	{
		if (marksWatched)
		{
			return;
		}

		marksWatched = true;
		var checked = function(ids)
		{
			dropMarks(function(mark)
			{
				return mark.kind != 'clash' && mark.glow == 'until-checked' && ids[mark.id] === true;
			});
		};

		graph.getSelectionModel().addListener(mxEvent.CHANGE, function()
		{
			var ids = {};
			graph.getSelectionCells().forEach(function(cell) { ids[cell.getId()] = true; });
			checked(ids);
		});
		graph.model.addListener(mxEvent.CHANGE, function(sender, evt)
		{
			var edit = evt.getProperty('edit'), ids = {};
			((edit != null) ? edit.changes : []).forEach(function(change)
			{
				var cell = change.cell || change.child;

				if (cell != null)
				{
					ids[cell.getId()] = true;
				}
			});
			checked(ids);
		});
	}

	/** The cells of the page on screen that the outside save added and changed (D5 outlines them). */
	function changedCells(theirs)
	{
		var page = (theirs.u || {})[editorUi.currentPage.getId()];
		var cells = (page != null && page.cells != null) ? page.cells : {};

		return {
			added: (cells.i || []).map(function(c) { return c.id; }),
			changed: Object.keys(cells.u || {})
		};
	}

	// 🔒 YAZ-1802 D12a: right-clicking EMPTY canvas offers draw.io's own Grid toggle (with its check
	// mark), beside the menu's zoom items. Wrapped last, so it lands at the end of the menu.
	var createPopupMenu = Menus.prototype.createPopupMenu;

	Menus.prototype.createPopupMenu = function(menu, cell, evt)
	{
		createPopupMenu.apply(this, arguments);

		if (this.editorUi.editor.graph.isSelectionEmpty())
		{
			menu.addSeparator();
			this.addMenuItems(menu, ['grid'], null, evt);
		}
	};

	// 🔒 YAZ-1802 D12a: dragging a TEXT box by a corner scales its font, like Excalidraw; a side
	// handle only changes one dimension, so the text just re-wraps. A shape's own label never
	// scales (Excalidraw's doesn't either). The font change lands inside draw.io's resize
	// transaction, so the drag stays ONE undo step; the guard keeps that change from re-entering.
	function installTextScaling(graph)
	{
		var scaling = false;

		graph.addListener(mxEvent.CELLS_RESIZED, function(sender, evt)
		{
			var cells = evt.getProperty('cells');
			var previous = evt.getProperty('previous');

			if (scaling)
			{
				return;
			}

			scaling = true;

			try
			{
				for (var i = 0; i < cells.length; i++)
				{
					var before = previous[i];
					var geo = graph.getModel().getGeometry(cells[i]);

					if (before.height > 0 && geo.width != before.width && geo.height != before.height &&
						cellKind(graph, cells[i]) == 'text')
					{
						var size = parseFloat(graph.getCellStyle(cells[i])[mxConstants.STYLE_FONTSIZE]) || mxConstants.DEFAULT_FONTSIZE;
						graph.setCellStyles(mxConstants.STYLE_FONTSIZE, Math.max(1, Math.round(size * geo.height / before.height)), [cells[i]]);
					}
				}
			}
			finally
			{
				scaling = false;
			}
		});
	}

	// ================================================================================
	// KEYMAP — Yasin's Excalidraw keys on draw.io (🔒 YAZ-1802 D12b).
	// With NOTHING selected a bare letter is a tool: those bindings are draw.io's own, set by the
	// host's configure reply (`keyboardShortcuts` in drawioProtocol.ts), as are the user's changed
	// keys (YAZ-3564 K4). Everything that acts on a selection is here — colour letters, Shift+colour,
	// 1–0 — plus the ⌘⇧X action. A colour letter no longer starts typing into a selected shape's
	// label; Enter / F2 still do.
	// ================================================================================

	/**
	 * The Excalidraw fork's colour letters (`SEMANTIC_COLOR_HOTKEYS`) over its open-colour palette,
	 * as [stroke shade, background shade] — palette index 4 and 1, the fork's
	 * `DEFAULT_ELEMENT_STROKE_COLOR_INDEX` / `DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX`. Transparent,
	 * black and white are one value for both.
	 */
	var COLOURS = {
		t: 'none',
		b: '#1e1e1e',
		w: '#ffffff',
		d: ['#343a40', '#e9ecef'],
		r: ['#e03131', '#ffc9c9'],
		p: ['#c2255c', '#fcc2d7'],
		a: ['#9c36b5', '#eebefa'],
		v: ['#6741d9', '#d0bfff'],
		u: ['#1971c2', '#a5d8ff'],
		c: ['#0c8599', '#99e9f2'],
		e: ['#099268', '#96f2d7'],
		g: ['#2f9e44', '#b2f2bb'],
		y: ['#f08c00', '#ffec99'],
		o: ['#e8590c', '#ffd8a8'],
		n: ['#846358', '#eaddd7']
	};

	/**
	 * The style key a colour letter sets, by what the cell is (`cellKind`), as [letter, Shift+letter]
	 * — the fork's rule: a shape fills (Shift strokes it), text takes the font colour (Shift its
	 * background), a line or a freehand stroke takes the stroke, and an image its border.
	 */
	var COLOUR_KEYS = {
		shape: [mxConstants.STYLE_FILLCOLOR, mxConstants.STYLE_STROKECOLOR],
		text: [mxConstants.STYLE_FONTCOLOR, mxConstants.STYLE_LABEL_BACKGROUNDCOLOR],
		line: [mxConstants.STYLE_STROKECOLOR, mxConstants.STYLE_STROKECOLOR],
		image: [mxConstants.STYLE_IMAGE_BORDER, mxConstants.STYLE_IMAGE_BORDER]
	};

	/** 1…9, 0 with a selection: a text's font size, or the long side of anything else (aspect and centre kept). */
	var SIZE_KEYS = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48];
	var FONT_SIZES = [12, 16, 20, 24, 28, 36, 48, 64, 96, 128];
	var SHAPE_SIZES = [48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

	/**
	 * What a cell is to the keymap and to text scaling: 'line' (an edge, or draw.io's freehand pen —
	 * an inline stencil drawn in its stroke colour, `lineShape=1` by default, `fillColor=none` in
	 * the classic pen), 'image', 'text' or 'shape'.
	 *
	 * "Text" means LOOKS like text (🔒 YAZ-1802 D12a): draw.io's own text style, or — how AI-written
	 * and hand-styled diagrams spell a title — a childless, labelled vertex with no fill and no border.
	 */
	function cellKind(graph, cell)
	{
		var model = graph.getModel();
		var style = graph.getCellStyle(cell);
		var shape = String(style[mxConstants.STYLE_SHAPE]);

		if (model.isEdge(cell) || (shape.indexOf('stencil(') == 0 &&
			(style.lineShape == '1' || style[mxConstants.STYLE_FILLCOLOR] == mxConstants.NONE)))
		{
			return 'line';
		}
		else if (shape == 'image')
		{
			return 'image';
		}
		else if (/^text(;|$)/.test(model.getStyle(cell) || '') || (model.getChildCount(cell) == 0 &&
			graph.convertValueToString(cell) != '' && isUnset(style[mxConstants.STYLE_FILLCOLOR]) &&
			isUnset(style[mxConstants.STYLE_STROKECOLOR])))
		{
			return 'text';
		}

		return 'shape';
	}

	function isUnset(colour)
	{
		return colour == null || colour == mxConstants.NONE;
	}

	/** A letter's colour for one style key: backgrounds take the light shade, strokes and text the dark one. */
	function colourValue(letter, key)
	{
		var entry = COLOURS[letter];

		if (typeof entry == 'string')
		{
			return entry;
		}

		return (key == mxConstants.STYLE_FILLCOLOR || key == mxConstants.STYLE_LABEL_BACKGROUNDCOLOR) ? entry[1] : entry[0];
	}

	// Both act on the EDITABLE selection, as draw.io's own style controls do: a locked cell keeps its look.
	function applyColour(graph, letter, shift)
	{
		var model = graph.getModel();
		var cells = graph.getEditableCells(graph.getSelectionCells());

		model.beginUpdate();

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				var key = COLOUR_KEYS[cellKind(graph, cells[i])][shift ? 1 : 0];
				graph.setCellStyles(key, colourValue(letter, key), [cells[i]]);
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	function applySize(graph, index)
	{
		var model = graph.getModel();
		var cells = graph.getEditableCells(graph.getSelectionCells());

		model.beginUpdate();

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				var geo = model.getGeometry(cells[i]);

				if (cellKind(graph, cells[i]) == 'text')
				{
					graph.setCellStyles(mxConstants.STYLE_FONTSIZE, FONT_SIZES[index], [cells[i]]);
					graph.updateCellSize(cells[i], true);
				}
				// An edge's label is a relative vertex, and a zero-size vertex has no long side to scale.
				else if (model.isVertex(cells[i]) && !geo.relative && geo.width > 0 && geo.height > 0)
				{
					model.setGeometry(cells[i], fitLongSide(geo, SHAPE_SIZES[index]));
				}
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	/** `geo` scaled about its centre until its long side is `side`. */
	function fitLongSide(geo, side)
	{
		var fitted = geo.clone();
		var k = side / Math.max(geo.width, geo.height);
		fitted.width = Math.round(geo.width * k);
		fitted.height = Math.round(geo.height * k);
		fitted.x = Math.round(geo.x + (geo.width - fitted.width) / 2);
		fitted.y = Math.round(geo.y + (geo.height - fitted.height) / 2);

		return fitted;
	}

	/**
	 * Installed after draw.io's own bindings AND the configure reply's, so these win.
	 *
	 * draw.io's key handler returns null for a bare A–Z while cells are selected, on purpose, so
	 * typing starts editing the label. The selection keys therefore sit in FRONT of that rule, in
	 * this instance's `getFunction`; with nothing selected every key falls through to draw.io.
	 */
	function installKeymap(ui)
	{
		var graph = ui.editor.graph;
		var keys = ui.keyHandler;
		var getFunction = keys.getFunction;

		keys.getFunction = function(evt)
		{
			// YAZ-3564 K15: on a Mac a ⌃ key the user gave an action is its own key, not draw.io's ⌘ one.
			var ctrlName = (mxClient.IS_MAC && evt.ctrlKey) ? ui.yaseenMacCtrlKeys[macCtrlId(evt.metaKey, mxEvent.isAltDown(evt), mxEvent.isShiftDown(evt), evt.keyCode)] : null;
			var ctrlAction = (ctrlName != null) ? ui.actions.get(ctrlName) : null;

			if (ctrlAction != null)
			{
				return function()
				{
					if (ctrlAction.isEnabled())
					{
						ctrlAction.funct.apply(this, arguments);
					}
				};
			}

			if (!graph.isSelectionEmpty() && !this.isControlDown(evt) && !mxEvent.isAltDown(evt))
			{
				var letter = String.fromCharCode(evt.keyCode).toLowerCase();
				var shift = mxEvent.isShiftDown(evt);
				var size = SIZE_KEYS.indexOf(evt.keyCode);

				if (COLOURS[letter] != null)
				{
					return function()
					{
						applyColour(graph, letter, shift);
					};
				}
				else if (size >= 0 && !shift)
				{
					return function()
					{
						applySize(graph, size);
					};
				}
			}

			return getFunction.apply(this, arguments);
		};
	}

	/** The id of a ⌃ key in `yaseenMacCtrlKeys`: ⌘, ⌥ and ⇧ held with it, then the keyCode. */
	function macCtrlId(cmd, alt, shift, keyCode)
	{
		return (cmd ? 'M' : '') + (alt ? 'A' : '') + (shift ? 'S' : '') + keyCode;
	}

	/** The keys draw.io cannot name in a shown key (`EditorUi.keyNames` has no punctuation). */
	var PUNCTUATION = {186: ';', 188: ',', 190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: '\''};

	/** A key as draw.io shows it beside an action: '⌘+⇧+D', its own order and marks. */
	function shownKey(c, keyCode)
	{
		var name = ((48 <= keyCode && keyCode <= 57) || (65 <= keyCode && keyCode <= 90)) ? String.fromCharCode(keyCode) :
			(EditorUi.keyNames[keyCode] || PUNCTUATION[keyCode]);

		return (name == null) ? null : (c.yaseenMacCtrl ? '⌃+' : '') + ((c.control || c.cmd) ? Editor.ctrlKey + '+' : '') +
			(c.alt ? Editor.altKey + '+' : '') + (c.shift ? Editor.shiftKey + '+' : '') + name;
	}

	var installKeyboardShortcuts = EditorUi.prototype.installKeyboardShortcuts;

	EditorUi.prototype.installKeyboardShortcuts = function()
	{
		var graph = this.editor.graph;
		this.yaseenMacCtrlKeys = {};

		// ⌘⇧X toggles strikethrough (fontStyle bit 8), as an action so that its key can change (YAZ-3564 K6):
		// the host's configure reply binds it. Given no cells, draw.io takes the editable selection.
		this.actions.addAction('yaseenStrikethrough', function()
		{
			if (graph.isEnabled())
			{
				graph.toggleCellStyleFlags(mxConstants.STYLE_FONTSTYLE, mxConstants.FONT_STRIKETHROUGH);
			}
		});

		installKeyboardShortcuts.apply(this, arguments);
		installKeymap(this);
	};

	// YAZ-3564: the configure reply's own kinds of entry, and the shown key of an action (K12).
	var installKeyboardShortcut = EditorUi.prototype.installKeyboardShortcut;

	EditorUi.prototype.installKeyboardShortcut = function(c)
	{
		var action = this.actions.get(c.action || c.yaseenUnlabel);

		// An action with no key now: draw.io leaves the shown key of a key it clears.
		if (c.yaseenUnlabel != null)
		{
			if (action != null)
			{
				action.shortcut = null;
			}

			return;
		}

		// K15: a ⌃ key on a Mac. draw.io's table holds ⌃D and ⌘D as one `control` key, so it goes to ours.
		if (c.yaseenMacCtrl)
		{
			this.yaseenMacCtrlKeys[macCtrlId(c.cmd, c.alt, c.shift, c.keyCode)] = c.action;
		}
		else
		{
			installKeyboardShortcut.apply(this, arguments);
		}

		// The shown key, in draw.io's own form: draw.io names only letters, digits and `EditorUi.keyNames`,
		// so a key like ⌘, or ⌘\ kept the action's old one, and it never sees a ⌃ key of ours.
		// The keyCode as draw.io reads it: one character is that key, anything else a number.
		var keyCode = (typeof c.keyCode === 'string' && c.keyCode.length == 1) ? c.keyCode.toUpperCase().charCodeAt(0) : parseInt(c.keyCode);
		var shown = (action != null) ? shownKey(c, keyCode) : null;

		if (shown != null)
		{
			action.shortcut = shown;
		}
	};

	/**
	 * A message to the host page, a JSON string like every embed message. Posted to any origin
	 * because the host's differs between dev (the Vite server) and a packaged app; nothing in it is
	 * private — draw.io posts the diagram itself the same way.
	 */
	function postToHost(msg)
	{
		window.parent.postMessage(JSON.stringify(msg), '*');
	}

	// 🔒 YAZ-1802 D12a: the fonts the editor offers first are files on THIS origin
	// (`yaseen-fonts/`, copied from the Excalidraw package by packDrawio) — never Google Fonts.
	// Their @font-face sheet goes through draw.io's own `fontCss` door, which also admits the URLs
	// for export; read here so the host never has to know the file names. A sheet that will not
	// load costs the fonts, never the handshake below.
	function loadFonts()
	{
		return fetch('yaseen-fonts/fonts.css').then(function(res)
		{
			return res.ok ? res.text() : null;
		}).then(Editor.configureFontCss).catch(function(e)
		{
			console.error('Yaseen fonts', e);
		});
	}

	// YAZ-4748: the link pills (`yaseen-links.js`, on this origin) patch draw.io's labels before the editor exists.
	// A script that will not load costs the pills, never the handshake below.
	function loadLinks()
	{
		return new Promise(function(resolve)
		{
			var script = document.createElement('script');
			script.src = 'js/yaseen-links.js';
			script.onload = resolve;
			script.onerror = function()
			{
				console.error('Yaseen links', script.src);
				resolve();
			};
			document.head.appendChild(script);
		});
	}

	// The handshake (see the header): everything above is in place, the host may configure now.
	Promise.all([loadFonts(), loadLinks()]).then(function()
	{
		postToHost({event: 'yaseenReady'});
	});
})();
