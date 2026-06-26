import type { FaqStatus } from '@rivus/core';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, type Faq } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { RivusSymbol } from '@/src/brand/RivusLogo';
import { BrandGradient } from '@/src/components/Gradient';
import {
	Card,
	GradientButton,
	Icon,
	OutlineButton,
	Pill,
	Segmented,
	TextField,
	Txt,
} from '@/src/components/ui';
import { colors, font, radii } from '@/src/theme/tokens';

const STATUS_OPTIONS: { label: string; value: FaqStatus }[] = [
	{ label: 'Published', value: 'published' },
	{ label: 'Draft', value: 'draft' },
];

export default function KnowledgeScreen() {
	const { session, client } = useAuth();

	const [list, setList] = useState<Faq[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState('All');

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Faq | null>(null);
	const [question, setQuestion] = useState('');
	const [answer, setAnswer] = useState('');
	const [category, setCategory] = useState('');
	const [status, setStatus] = useState<FaqStatus>('published');
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const load = useCallback(async () => {
		if (!session) {
			return;
		}
		setLoading(true);
		setError(null);
		try {
			// The API caps pageSize at 100 and this screen has no pagination/search UI,
			// so page through everything — otherwise FAQs past the first 100 would vanish
			// from the list with no way to edit or delete them.
			const all: Faq[] = [];
			let page = 1;
			let hasNext = true;
			while (hasNext) {
				const { data, meta } = await client.listFaqs(session.token, { page, pageSize: 100 });
				all.push(...data);
				hasNext = meta.hasNextPage;
				page += 1;
			}
			setList(all);
		} catch (caught) {
			setError(caught instanceof ApiError ? caught.message : 'Could not load your FAQs.');
		} finally {
			setLoading(false);
		}
	}, [client, session]);

	useEffect(() => {
		load();
	}, [load]);

	function openCreate() {
		setEditing(null);
		setQuestion('');
		setAnswer('');
		setCategory('');
		setStatus('published');
		setFormError(null);
		setFormOpen(true);
	}

	function openEdit(faq: Faq) {
		setEditing(faq);
		setQuestion(faq.question);
		setAnswer(faq.answer);
		setCategory(faq.category);
		setStatus(faq.status);
		setFormError(null);
		setFormOpen(true);
	}

	function closeForm() {
		setFormOpen(false);
		setFormError(null);
	}

	async function onSave() {
		if (!session || saving) {
			return;
		}
		setFormError(null);
		setSaving(true);
		try {
			const input = {
				question: question.trim(),
				answer: answer.trim(),
				category: category.trim(),
				status,
			};
			if (editing) {
				await client.updateFaq(session.token, editing.id, input);
			} else {
				await client.createFaq(session.token, input);
			}
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : 'Could not save the FAQ.');
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		if (!session || !editing || deleting) {
			return;
		}
		setFormError(null);
		setDeleting(true);
		try {
			await client.deleteFaq(session.token, editing.id);
			closeForm();
			await load();
		} catch (caught) {
			setFormError(caught instanceof ApiError ? caught.message : 'Could not delete the FAQ.');
		} finally {
			setDeleting(false);
		}
	}

	if (!session) {
		return null;
	}

	const categories = [
		'All',
		...Array.from(new Set(list.map((faq) => faq.category).filter(Boolean))).sort(),
	];
	const visible = active === 'All' ? list : list.filter((faq) => faq.category === active);

	return (
		<ScrollView contentContainerStyle={styles.scroll}>
			<View style={styles.inner}>
				<View style={styles.head}>
					<View style={{ flex: 1, minWidth: 200 }}>
						<Txt style={styles.title}>Knowledge</Txt>
						<Txt style={styles.subtitle}>
							The FAQs Rivus uses to answer your customers. Post once — Rivus handles the rest.
						</Txt>
					</View>
					<GradientButton label="Add FAQ" icon="plus" onPress={openCreate} />
				</View>

				<View style={styles.banner}>
					<View style={styles.bannerGlow} />
					<Txt style={styles.bannerTxt}>
						Rivus answered <Txt style={styles.bannerBold}>213 customer questions</Txt> from these
						FAQs this month — no human needed.
					</Txt>
				</View>

				<View style={styles.suggested}>
					<BrandGradient style={styles.suggestedMark}>
						<RivusSymbol size={18} />
					</BrandGradient>
					<View style={{ flex: 1, minWidth: 180 }}>
						<Txt style={styles.suggestedTitle}>Rivus noticed a new common question</Txt>
						<Txt style={styles.suggestedSub}>
							“Do you install tankless water heaters?” — asked 14 times this week. Add an answer?
						</Txt>
					</View>
					<Pressable style={styles.suggestedBtn}>
						<Txt style={styles.suggestedBtnTxt}>Add answer</Txt>
					</Pressable>
				</View>

				{formOpen ? (
					<Card style={styles.form}>
						<View style={styles.formHead}>
							<Txt style={styles.formTitle}>{editing ? 'Edit FAQ' : 'New FAQ'}</Txt>
							<Pressable onPress={closeForm} accessibilityRole="button">
								<Icon name="x" size={18} color={colors.textMuted} />
							</Pressable>
						</View>
						<TextField
							label="Question"
							value={question}
							onChangeText={setQuestion}
							placeholder="How much does a service call cost?"
						/>
						<TextField
							label="Answer"
							value={answer}
							onChangeText={setAnswer}
							placeholder="Our standard diagnostic visit is $89…"
							multiline
							style={styles.answerInput}
						/>
						<TextField
							label="Category"
							value={category}
							onChangeText={setCategory}
							placeholder="Pricing"
							hint="Optional — groups FAQs in the filter bar."
							autoCapitalize="words"
						/>
						<View style={styles.fieldWrap}>
							<Txt style={styles.fieldLabel}>Status</Txt>
							<Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} />
						</View>

						{formError ? <Txt style={styles.errorTxt}>{formError}</Txt> : null}

						<View style={styles.btnRow}>
							<GradientButton
								label={saving ? 'Saving…' : editing ? 'Save changes' : 'Add FAQ'}
								icon="check"
								onPress={onSave}
								style={styles.btnGrow}
							/>
							<OutlineButton label="Cancel" onPress={closeForm} style={styles.btnGrow} />
						</View>
						{editing ? (
							<OutlineButton
								label={deleting ? 'Deleting…' : 'Delete FAQ'}
								onPress={onDelete}
								style={styles.deleteBtn}
							/>
						) : null}
					</Card>
				) : null}

				{list.length > 0 ? (
					<View style={styles.filters}>
						{categories.map((cat) => {
							const on = cat === active;
							return (
								<Pressable
									key={cat}
									onPress={() => setActive(cat)}
									style={[styles.filter, on && styles.filterOn]}
								>
									<Txt style={[styles.filterTxt, on && styles.filterTxtOn]}>{cat}</Txt>
								</Pressable>
							);
						})}
					</View>
				) : null}

				{loading ? (
					<ActivityIndicator color={colors.brandPurple} style={styles.loading} />
				) : error ? (
					<Txt style={styles.errorTxt}>{error}</Txt>
				) : visible.length === 0 ? (
					<Txt style={styles.empty}>
						{list.length === 0
							? 'No FAQs yet. Add your first one so Rivus can start answering with it.'
							: 'No FAQs in this category.'}
					</Txt>
				) : (
					<View style={{ gap: 12 }}>
						{visible.map((faq) => (
							<View key={faq.id} style={styles.faq}>
								<View style={styles.faqHead}>
									<View style={styles.faqQ}>
										<Pill
											label={faq.category || 'General'}
											color={colors.brandPurple}
											background={colors.purpleTint}
										/>
										<Txt style={styles.faqQuestion} numberOfLines={1}>
											{faq.question}
										</Txt>
									</View>
									<Pressable
										style={styles.editBtn}
										onPress={() => openEdit(faq)}
										accessibilityRole="button"
									>
										<Icon name="edit-3" size={17} color={colors.textFaint} />
									</Pressable>
								</View>
								<Txt style={styles.faqAnswer}>{faq.answer}</Txt>
								<View style={styles.faqFoot}>
									{faq.status === 'published' ? (
										<BrandGradient style={styles.faqFootMark} />
									) : (
										<View style={[styles.faqFootMark, styles.faqFootMarkDraft]} />
									)}
									<Txt style={styles.faqFootTxt}>
										{faq.status === 'published'
											? 'Published — Rivus answers with this'
											: 'Draft — not in use yet'}
									</Txt>
								</View>
							</View>
						))}
					</View>
				)}
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	scroll: { padding: 24, paddingBottom: 44 },
	inner: { maxWidth: 920, width: '100%', alignSelf: 'center', gap: 0 },
	head: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		justifyContent: 'space-between',
		gap: 16,
		flexWrap: 'wrap',
		marginBottom: 20,
	},
	title: { fontFamily: font.semibold, fontSize: 20 },
	subtitle: { fontFamily: font.regular, fontSize: 13, color: colors.textMuted, marginTop: 3 },

	banner: {
		backgroundColor: '#13131f',
		borderRadius: radii.xxl,
		paddingVertical: 18,
		paddingHorizontal: 22,
		marginBottom: 20,
		overflow: 'hidden',
	},
	bannerGlow: {
		position: 'absolute',
		right: -30,
		top: -50,
		width: 200,
		height: 200,
		borderRadius: 100,
		backgroundColor: 'rgba(30,190,250,0.22)',
	},
	bannerTxt: { fontFamily: font.medium, fontSize: 15, color: '#f3f1fb', lineHeight: 22 },
	bannerBold: { fontFamily: font.bold, color: '#fff' },

	suggested: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
		flexWrap: 'wrap',
		backgroundColor: 'rgba(110,30,200,0.05)',
		borderWidth: 1,
		borderColor: 'rgba(110,30,200,0.16)',
		borderRadius: radii.xxl,
		paddingVertical: 16,
		paddingHorizontal: 18,
		marginBottom: 22,
	},
	suggestedMark: {
		width: 30,
		height: 30,
		borderRadius: radii.sm,
		alignItems: 'center',
		justifyContent: 'center',
	},
	suggestedTitle: { fontFamily: font.semibold, fontSize: 13.5, color: '#2e2440' },
	suggestedSub: {
		fontFamily: font.regular,
		fontSize: 12.5,
		color: '#6b5b85',
		marginTop: 2,
		lineHeight: 18,
	},
	suggestedBtn: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: '#ddcdec',
		paddingVertical: 8,
		paddingHorizontal: 14,
		borderRadius: 9,
	},
	suggestedBtnTxt: { fontFamily: font.semibold, fontSize: 12.5, color: colors.brandPurple },

	form: { gap: 14, marginBottom: 22 },
	formHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	formTitle: { fontFamily: font.semibold, fontSize: 15, color: colors.text },
	fieldWrap: { gap: 6 },
	fieldLabel: { fontFamily: font.semibold, fontSize: 12.5, color: colors.textSub },
	answerInput: { minHeight: 92, textAlignVertical: 'top' },
	btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
	btnGrow: { flexGrow: 1, flexBasis: 140 },
	deleteBtn: { borderColor: 'rgba(240,88,75,0.4)' },

	filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
	filter: {
		paddingVertical: 6,
		paddingHorizontal: 14,
		borderRadius: radii.pill,
		backgroundColor: colors.borderSoft,
	},
	filterOn: { backgroundColor: colors.text },
	filterTxt: { fontFamily: font.medium, fontSize: 12.5, color: colors.textSub },
	filterTxtOn: { fontFamily: font.semibold, color: '#fff' },

	loading: { paddingVertical: 24 },
	empty: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textMuted,
		paddingVertical: 16,
	},

	faq: {
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radii.xl,
		paddingVertical: 18,
		paddingHorizontal: 20,
	},
	faqHead: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
		marginBottom: 8,
	},
	faqQ: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 },
	faqQuestion: { fontFamily: font.semibold, fontSize: 14.5, flex: 1 },
	editBtn: { padding: 4 },
	faqAnswer: {
		fontFamily: font.regular,
		fontSize: 13,
		color: colors.textSub,
		lineHeight: 20,
		marginBottom: 11,
	},
	faqFoot: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 7,
		borderTopWidth: 1,
		borderTopColor: colors.borderRow,
		paddingTop: 11,
	},
	faqFootMark: { width: 14, height: 14, borderRadius: 4 },
	faqFootMarkDraft: { backgroundColor: colors.textHint },
	faqFootTxt: { fontFamily: font.regular, fontSize: 11.5, color: colors.textFaint },
	errorTxt: { fontFamily: font.medium, fontSize: 12.5, color: colors.redInk },
});
