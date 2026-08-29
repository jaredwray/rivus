import { platforms } from '../../lib/site';
import { Icon } from './icons';
import { Link } from './link';

export function CrossPlatform() {
	return (
		<section className="section--plain section--edge">
			<div className="platforms">
				<h2 className="h2">Run it from the truck, the shop, or the couch.</h2>
				<p className="lead">
					Your whole team gets Rivus on the web today, with{' '}
					<Link href="/apps">iPhone and Android apps on the way</Link> — fully in sync, wherever the
					day takes them.
				</p>
				<div className="platforms__list">
					{platforms.map((platform) => (
						<div key={platform.label} className="platform">
							<Icon name={platform.icon} size={22} />
							{platform.label}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
