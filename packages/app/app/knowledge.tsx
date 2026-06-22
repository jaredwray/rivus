import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RivusSymbol } from '@/src/brand/RivusLogo';
import { BrandGradient } from '@/src/components/Gradient';
import { GradientButton, Icon, Pill, Txt } from '@/src/components/ui';
import { faqCategories, faqs } from '@/src/data/demo';
import { colors, font, radii } from '@/src/theme/tokens';

export default function KnowledgeScreen() {
	const [active, setActive] = useState('All');
	const visible = active === 'All' ? faqs : faqs.filter((f) => f.cat === active);

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
					<GradientButton label="Add FAQ" icon="plus" />
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

				<View style={styles.filters}>
					{faqCategories.map((cat) => {
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

				<View style={{ gap: 12 }}>
					{visible.map((f) => (
						<View key={f.q} style={styles.faq}>
							<View style={styles.faqHead}>
								<View style={styles.faqQ}>
									<Pill label={f.cat} color={colors.brandPurple} background={colors.purpleTint} />
									<Txt style={styles.faqQuestion} numberOfLines={1}>
										{f.q}
									</Txt>
								</View>
								<Pressable style={styles.editBtn}>
									<Icon name="edit-3" size={17} color={colors.textFaint} />
								</Pressable>
							</View>
							<Txt style={styles.faqAnswer}>{f.a}</Txt>
							<View style={styles.faqFoot}>
								<BrandGradient style={styles.faqFootMark} />
								<Txt style={styles.faqFootTxt}>{f.uses}</Txt>
							</View>
						</View>
					))}
				</View>
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
	faqFootTxt: { fontFamily: font.regular, fontSize: 11.5, color: colors.textFaint },
});
