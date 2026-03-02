/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from '../../../browser/editorBrowser.js';
import { Range } from '../../../common/core/range.js';
import { QuickFixHoverWidget, IQuickFixInfo } from './quickFixHoverWidget.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorContribution } from '../../../common/editorCommon.js';
import { IMarkerDecorationsService } from '../../../common/services/markerDecorations.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { CodeActionTriggerType } from '../../../common/languages.js';
import { CodeActionKind, CodeActionSet, CodeActionTrigger, CodeActionTriggerSource } from '../../codeAction/common/types.js';
import { ApplyCodeActionReason, getCodeActions } from '../../codeAction/browser/codeAction.js';
import { CodeActionController } from '../../codeAction/browser/codeActionController.js';
import { Progress } from '../../../../platform/progress/common/progress.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export class QuickFixHoverController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.quickFixHoverController';

	private readonly _quickFixHoverWidget: QuickFixHoverWidget;

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IMarkerDecorationsService private readonly _markerDecorationsService: IMarkerDecorationsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService
	) {
		super();
		this._quickFixHoverWidget = this._register(
			instantiationService.createInstance(QuickFixHoverWidget, this._editor)
		);

		// 与 ContentHoverController 一样，通过编辑器的鼠标事件触发。
		this._register(this._editor.onMouseDown(e => this._onMouseDown(e)));
	}

	public static get(editor: ICodeEditor): QuickFixHoverController | null {
		return editor.getContribution<QuickFixHoverController>(QuickFixHoverController.ID);
	}

	private async _onMouseDown(e: IEditorMouseEvent): Promise<void> {
		if (!this._editor.hasModel()) {
			return;
		}

		const target = e.target;
		if (target.type !== MouseTargetType.CONTENT_TEXT) {
			return;
		}

		const range = target.range as Range;
		const model = this._editor.getModel();

		// 仅当当前位置存在诊断（marker）时才响应点击
		const lineDecorations = this._editor.getLineDecorations(range.startLineNumber) ?? [];
		let hasMarker = false;
		for (const d of lineDecorations) {
			const marker = this._markerDecorationsService.getMarker(model.uri, d);
			if (!marker) {
				continue;
			}
			// 简单判断：marker 与点击范围同一行且有交集即可
			if (marker.startLineNumber <= range.endLineNumber && marker.endLineNumber >= range.startLineNumber) {
				hasMarker = true;
				break;
			}
		}
		if (!hasMarker) {
			return;
		}

		// 使用通用 getCodeActions 获取当前点击处的 quick fix 列表
		const trigger: CodeActionTrigger = {
			type: CodeActionTriggerType.Invoke,
			filter: { include: CodeActionKind.QuickFix },
			triggerAction: CodeActionTriggerSource.QuickFixHover
		};

		let codeActionSet: CodeActionSet;
		try {
			codeActionSet = await getCodeActions(
				this._languageFeaturesService.codeActionProvider,
				model,
				range,
				trigger,
				Progress.None,
				CancellationToken.None
			);
		} catch {
			return;
		}

		if (!codeActionSet.validActions.length) {
			codeActionSet.dispose();
			this._quickFixHoverWidget.hide();
			return;
		}

		const controller = CodeActionController.get(this._editor);

		const fixes: IQuickFixInfo[] = codeActionSet.validActions.map(item => {
			const detail = item.action.diagnostics?.map(diag => diag.message).join('\n');
			return {
				id: item.action.command?.id ?? item.action.title,
				label: item.action.title,
				detail,
				run: () => {
					controller?.applyCodeAction(item, /* retrigger */ false, /* preview */ false, ApplyCodeActionReason.FromProblemsHover);
					codeActionSet.dispose();
				}
			};
		});

		this._quickFixHoverWidget.showQuickFixes(range, fixes, /* shouldFocus */ true);
	}

	public override dispose(): void {
		super.dispose();
	}
}

