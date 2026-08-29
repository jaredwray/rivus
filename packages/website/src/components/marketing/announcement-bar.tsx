import { SparkleIcon } from './icons';
import { Link } from './link';

export function AnnouncementBar() {
	return (
		<Link className="announce" href="/#onboarding">
			<SparkleIcon size={16} />
			<span>
				Every account includes a free onboarding specialist — a real human who sets it all up for
				you. <span className="announce__cta">See how</span>
			</span>
		</Link>
	);
}
