import React from 'react'

export default class LandingPress extends React.Component {
	render() {
		return (
			<section className="Partners">
				<div className="row text-center">
					<div className="small-12 columns">
						<h2>Партнеры</h2>
					</div>
				</div>
				<div className="row Partners__logos">
					<div className="small-6 medium-4 large-2">
						<a href="https://cyber.fund/" target="blank">
							<img src="https://www.steemimg.com/images/2016/08/24/cyberfund92a82.jpg" alt="cyber.fund logo" />
						</a>
					</div>

				</div>
				<div className="row">
					<div className="small-12 columns">
						<h3>Правовые партнеры</h3>
					</div>
				</div>
				<div className="row Partners__law">
					<div className="small-12 medium-6 columns">
						<a href="http://www.atplaw.ru/" target="blank">
							<img src="images/landing/tolkachev.jpg" alt='логотип "Толкачев и партнеры"' />
						</a>
					</div>
					<div className="small-12 medium-6 columns">
						<a href="http://sk.ru" target="blank">
							<img src="images/landing/skolkovo.jpg" alt="логотип Сколково" />
						</a>
					</div>
				</div>
				<div className="row Partners__info" style={{justifyContent: 'center',
    alignItems: 'center'}}>
					<div className="small-12 columns">
						<h3>Информационные партнеры</h3>
					</div>
					<div className="small-12 medium-6 columns">
						<a href="http://www.coinfox.ru/" target="blank">
							<img src="images/landing/coinfox.jpg" alt="логотип Coinfox" />
						</a>
					</div>
					<div className="small-12 medium-6 columns">
						<a href="http://forklog.com/" target="blank">
							<img src="images/landing/forklog.jpg" alt="логотип Forklog" />
						</a>
					</div>
				</div>
				<hr />
			</section>
		)
	}
}
