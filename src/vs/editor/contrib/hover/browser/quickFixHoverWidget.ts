/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


/*---------------------------------------------------------------------------------------------
 *  Quick fix hover widget based on ContentHoverWidget
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { Range } from '../../../common/core/range.js';
import { HoverStartSource } from './hoverOperation.js';
import { HoverRangeAnchor, IEditorHoverContext, IEditorHoverParticipant, IHoverPart, IRenderedHoverPart, RenderedHoverParts } from './hoverTypes.js';
import { ContentHoverResult } from './contentHoverTypes.js';
import { ContentHoverWidget } from './contentHoverWidget.js';
import { RenderedContentHover } from './contentHoverRendered.js';
import { Dimension } from '../../../../base/browser/dom.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ScrollEvent } from '../../../../base/common/scrollable.js';
import { IModelDecoration } from '../../../common/model.js';
import { HoverVerbosityAction } from '../../../common/languages.js';
import * as nls from '../../../../nls.js';

/**
 * Quick fix 信息结构，可以根据你项目中的 QuickFix 数据结构调整。
 */
export interface IQuickFixInfo {
	id: string;
	label: string;
	detail?: string;
	/**
	 * 执行修复的回调。
	 */
	run: () => void;
}

/**
 * 单个 quick fix 的 hover part。
 */
class QuickFixHoverPart implements IHoverPart {
	constructor(
		public readonly owner: IEditorHoverParticipant,
		public readonly range: Range,
		public readonly quickFix: IQuickFixInfo
	) { }

	public isValidForHoverAnchor(anchor: HoverRangeAnchor): boolean {
		return anchor.range.containsRange(this.range);
	}
}

/**
 * 负责把 quick fix 渲染成 DOM 的 participant。
 */
class QuickFixHoverParticipant implements IEditorHoverParticipant<QuickFixHoverPart> {

	public readonly hoverOrdinal = 10_000; // 比普通 hover 晚一点渲染即可

	private _keybindingLabel: string | undefined;

	constructor(
		private readonly _editor: ICodeEditor
	) {
		console.log(this._editor);
	}

	public setKeybindingLabel(label: string | undefined): void {
		this._keybindingLabel = label;
	}

	public suggestHoverAnchor(): null {
		// 不参与自动 hover 触发，只用于显式 showQuickFixes
		return null;
	}

	public computeSync(
		anchor: HoverRangeAnchor,
		lineDecorations: IModelDecoration[],
		source: HoverStartSource
	): QuickFixHoverPart[] {
		// 本 participant 不参与普通 hover 的计算
		return [];
	}

	public computeAsync?(
		anchor: HoverRangeAnchor,
		lineDecorations: IModelDecoration[],
		source: HoverStartSource,
		token: CancellationToken
	): AsyncIterable<QuickFixHoverPart> {
		// 不需要异步计算
		return {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						return { done: true, value: undefined as any };
					}
				};
			}
		};
	}

	public createLoadingMessage(): QuickFixHoverPart | null {
		return null;
	}

	public renderHoverParts(
		context: IEditorHoverContext & { fragment: DocumentFragment },
		hoverParts: QuickFixHoverPart[]
	): RenderedHoverParts<QuickFixHoverPart> {

		const rendered: IRenderedHoverPart<QuickFixHoverPart>[] = [];

		const root = dom.$('.monaco-quickfix-hover');

		// 头部：图标 + 文本 + 快捷键提示
		const header = dom.$('.monaco-quickfix-header');
		const icon = dom.$('.codicon.codicon-light-bulb');
		header.appendChild(icon);

		const titleText = nls.localize('quickFixWidgetTitle', "Quick Fix");
		const headerLabel = dom.$('.monaco-quickfix-header-label');
		headerLabel.textContent = this._keybindingLabel
			? `${titleText} (${this._keybindingLabel})`
			: titleText;
		header.appendChild(headerLabel);

		root.appendChild(header);

		context.fragment.appendChild(root);

		for (const part of hoverParts) {
			const item = dom.$('.monaco-quickfix-item');
			item.tabIndex = 0;

			const title = dom.$('.monaco-quickfix-title');
			title.textContent = part.quickFix.label;
			item.appendChild(title);

			if (part.quickFix.detail) {
				const detail = dom.$('.monaco-quickfix-detail');
				detail.textContent = part.quickFix.detail;
				item.appendChild(detail);
			}

			const runFix = () => {
				part.quickFix.run();
				context.hide();
			};

			const clickDisposable = dom.addDisposableListener(item, dom.EventType.CLICK, () => runFix());
			const keyDisposable = dom.addDisposableListener(item, dom.EventType.KEY_DOWN, e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					runFix();
				}
			});

			root.appendChild(item);

			const renderedPart: IRenderedHoverPart<QuickFixHoverPart> = {
				hoverPart: part,
				hoverElement: item,
				dispose() {
					clickDisposable.dispose();
					keyDisposable.dispose();
				}
			};

			rendered.push(renderedPart);
		}

		return new RenderedHoverParts(rendered);
	}

	public getAccessibleContent(hoverPart: QuickFixHoverPart): string {
		return hoverPart.quickFix.detail
			? `${hoverPart.quickFix.label}. ${hoverPart.quickFix.detail}`
			: hoverPart.quickFix.label;
	}

	public handleResize?(): void { }
	public handleHide?(): void { }
	public handleContentsChanged?(): void { }
	public handleScroll?(e: ScrollEvent): void { }

	public doesHoverAtIndexSupportVerbosityAction(): boolean {
		return false;
	}

	public async updateHoverVerbosityLevel(
		action: HoverVerbosityAction,
		index: number,
		focus?: boolean
	): Promise<void> {
		// 不支持多级详细度
	}
}

/**
 * 基于 ContentHoverWidget 的 QuickFix widget。
 */
export class QuickFixHoverWidget extends ContentHoverWidget {

	public static override ID = 'editor.contrib.quickFixHoverWidget';

	private readonly _quickFixParticipant: QuickFixHoverParticipant;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IKeybindingService private readonly _quickFixKeybindingService: IKeybindingService,
		@IHoverService private readonly _quickFixHoverService: IHoverService,
		@IClipboardService private readonly _quickFixClipboardService: IClipboardService
	) {
		super(editor, contextKeyService, configurationService, accessibilityService, _quickFixKeybindingService);

		this._quickFixParticipant = new QuickFixHoverParticipant(editor);
	}

	public override getId(): string {
		return QuickFixHoverWidget.ID;
	}

	/**
	 * 在指定 range 处显示 quick fix 信息。
	 */
	public showQuickFixes(range: Range, fixes: IQuickFixInfo[], shouldFocus = true): void {
		if (!fixes.length) {
			this.hide();
			return;
		}

		// 每次显示前更新一次快捷键提示
		const kb:any = this._quickFixKeybindingService.lookupKeybinding('editor.action.quickFix');
		this._quickFixParticipant.setKeybindingLabel(kb?.getLabel());

		// 构造 hover anchor
		const anchor = new HoverRangeAnchor(0, range, undefined, undefined);

		// 构造 quick fix hover parts
		const hoverParts = fixes.map(fix => new QuickFixHoverPart(this._quickFixParticipant, range, fix));

		// 组装 ContentHoverResult
		const hoverOptions = {
			shouldFocus,
			anchor,
			source: HoverStartSource.Mouse,
			insistOnKeepingHoverVisible: false
		};
		const hoverResult = new ContentHoverResult(hoverParts, true, hoverOptions);

		// 提供给 RenderedContentHover 的 context
		const context: IEditorHoverContext = {
			hide: () => this.hide(),
			onContentsChanged: () => this.handleContentsChanged(),
			setMinimumDimensions: (dimensions: Dimension) => this.setMinimumDimensions(dimensions),
			focus: () => this.focus()
		};

		// 使用和 ContentHoverWidgetWrapper 相同的渲染逻辑
		const renderedHover = new RenderedContentHover(
			this._editor,
			hoverResult,
			[this._quickFixParticipant],
			context,
			this._quickFixKeybindingService,
			this._quickFixHoverService,
			this._quickFixClipboardService
		);

		if (renderedHover.domNodeHasChildren) {
			this.show(renderedHover);
		} else {
			renderedHover.dispose();
			this.hide();
		}
	}
}
