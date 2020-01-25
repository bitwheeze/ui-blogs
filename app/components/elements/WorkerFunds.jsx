import React from 'react';
import golos from 'golos-classic-js';
import { connect } from 'react-redux';

import Tooltip from 'app/components/elements/Tooltip.jsx';
import { formatAsset } from 'app/utils/ParsersAndFormatters';

class WorkerFunds extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      balance: "0.000 GOLOS",
      sbd_balance: "0.000 GOLOS"
    };
  }

  componentDidMount() {
  }

  componentWillUnmount() {
  }

  render() {
    const { balance, sbd_balance } = this.props.workersAcc;
    return(
      <span className="WorkerFunds">
        <Tooltip t="Текущий баланс фонда воркеров">
          Состояние фонда:
          &nbsp;
          <span className="WorkerFunds__card">{formatAsset(balance,false)} GOLOS</span>
          &nbsp;и&nbsp;
          <span className="WorkerFunds__card">{formatAsset(sbd_balance,false)} GBG</span>
        </Tooltip>
      </span>
    );
  }
}

export default connect(
    state => {
        const workersAcc = state.global.getIn(['accounts', 'workers']).toJS();
        return {
            workersAcc
        };
    },
    dispatch => {
        return {
        };
    }
)(WorkerFunds);
